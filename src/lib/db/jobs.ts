import { execute, now, nullable, select, transaction } from './index';
import { deductStatement } from './spools';
import { incrementStatement } from './parts';
import { touchStatement } from './projects';
import { completeStatement } from './plan';
import type {
	JobStatus,
	PartCounted,
	PartOnPlate,
	PrintJobDecoded,
	PrintPlateDecoded,
	SpoolAssignment
} from '$lib/types/schema';

interface JobRow {
	id: number;
	plate_id: number;
	spool_ids_used_json: string;
	parts_counted_json: string | null;
	started_at: string;
	completed_at: string | null;
	status: JobStatus;
	actual_duration_seconds: number | null;
	failure_reason: string | null;
	plate_name: string;
}

/** Tolerates legacy or hand-edited JSON rather than throwing on render. */
function parseArray<T>(raw: string | null | undefined): T[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as T[]) : [];
	} catch {
		return [];
	}
}

function mapJob(row: JobRow): PrintJobDecoded {
	return {
		id: row.id,
		plateId: row.plate_id,
		spoolIdsUsedJson: row.spool_ids_used_json,
		partsCountedJson: row.parts_counted_json ?? '[]',
		startedAt: row.started_at,
		completedAt: row.completed_at,
		status: row.status,
		actualDurationSeconds: row.actual_duration_seconds,
		failureReason: row.failure_reason,
		spoolsUsed: parseArray<SpoolAssignment>(row.spool_ids_used_json),
		partsCounted: parseArray<PartCounted>(row.parts_counted_json),
		plateName: row.plate_name
	};
}

export async function listJobsForProject(projectId: number): Promise<PrintJobDecoded[]> {
	const rows = await select<JobRow>(
		`SELECT j.*, pl.name AS plate_name
		 FROM print_jobs j
		 JOIN print_plates pl ON pl.id = j.plate_id
		 WHERE pl.project_id = ?
		 ORDER BY j.started_at DESC, j.id DESC`,
		[projectId]
	);
	return rows.map(mapJob);
}

export async function deleteJob(id: number): Promise<void> {
	await execute('DELETE FROM print_jobs WHERE id = ?', [id]);
}

export interface LogJobInput {
	plate: PrintPlateDecoded;
	status: JobStatus;
	/** Spool chosen per filament slot, with the grams to deduct. */
	assignments: SpoolAssignment[];
	startedAt: string;
	actualDurationSeconds?: number | null;
	failureReason?: string | null;
	/**
	 * Plan entry this print fulfils, if it was started from the print plan.
	 * Only a successful print closes it — a failed or cancelled plate still
	 * needs printing, so it stays on the plan.
	 */
	planEntryId?: number | null;
	/** Part id → name, so the job can record readable history. */
	partNames?: Map<number, string>;
}

/**
 * Writes a print job and everything it implies in one transaction:
 *
 * - `success` — deduct filament, increment each part's `printedQuantity`
 * - `failed`  — deduct filament, increment each part's `failedQuantity`
 * - `cancelled` — record only, stock and counters untouched
 *
 * Either all of it lands or none of it does, so stock can never drift out of
 * step with the part counters.
 */
export async function logPrintJob(input: LogJobInput): Promise<void> {
	const { plate, status, assignments, startedAt } = input;
	const completedAt = now();

	/**
	 * What this job did to the part counters, recorded on the job itself.
	 * Names are copied in rather than joined later: the history should still
	 * read correctly after a part is renamed or the plate is re-linked.
	 */
	const counter: 'printed' | 'failed' = status === 'success' ? 'printed' : 'failed';
	const partsCounted: PartCounted[] =
		status === 'cancelled'
			? []
			: (plate.partsOnPlate as PartOnPlate[])
					.filter((part) => part.quantityOnPlate > 0)
					.map((part) => ({
						partId: part.partId,
						name: input.partNames?.get(part.partId) ?? `#${part.partId}`,
						quantity: part.quantityOnPlate,
						counter
					}));

	const statements = [
		{
			sql: `INSERT INTO print_jobs
			        (plate_id, spool_ids_used_json, parts_counted_json, started_at, completed_at,
			         status, actual_duration_seconds, failure_reason)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			params: [
				plate.id!,
				JSON.stringify(assignments),
				JSON.stringify(partsCounted),
				startedAt,
				completedAt,
				status,
				input.actualDurationSeconds ?? null,
				nullable(input.failureReason)
			]
		}
	];

	// Directly after the INSERT: `completeStatement` resolves the new job's id
	// with `last_insert_rowid()`, which only holds while nothing else inserted.
	if (status === 'success' && input.planEntryId) {
		statements.push(completeStatement(input.planEntryId));
	}

	if (status !== 'cancelled') {
		for (const assignment of assignments) {
			if (assignment.weightGrams > 0) {
				statements.push(deductStatement(assignment.spoolId, assignment.weightGrams));
			}
		}

		for (const part of plate.partsOnPlate as PartOnPlate[]) {
			if (part.quantityOnPlate > 0) {
				statements.push(incrementStatement(part.partId, counter, part.quantityOnPlate));
			}
		}
	}

	statements.push(touchStatement(plate.projectId));
	await transaction(statements);
}
