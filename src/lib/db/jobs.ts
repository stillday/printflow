import { execute, now, nullable, select, transaction } from './index';
import { deductStatement } from './spools';
import { incrementStatement } from './parts';
import { touchStatement } from './projects';
import type {
	JobStatus,
	PartOnPlate,
	PrintJobDecoded,
	PrintPlateDecoded,
	SpoolAssignment
} from '$lib/types/schema';

interface JobRow {
	id: number;
	plate_id: number;
	spool_ids_used_json: string;
	started_at: string;
	completed_at: string | null;
	status: JobStatus;
	actual_duration_seconds: number | null;
	failure_reason: string | null;
	plate_name: string;
}

function mapJob(row: JobRow): PrintJobDecoded {
	let spoolsUsed: SpoolAssignment[] = [];
	try {
		const parsed = JSON.parse(row.spool_ids_used_json);
		if (Array.isArray(parsed)) spoolsUsed = parsed;
	} catch {
		spoolsUsed = [];
	}
	return {
		id: row.id,
		plateId: row.plate_id,
		spoolIdsUsedJson: row.spool_ids_used_json,
		startedAt: row.started_at,
		completedAt: row.completed_at,
		status: row.status,
		actualDurationSeconds: row.actual_duration_seconds,
		failureReason: row.failure_reason,
		spoolsUsed,
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

	const statements = [
		{
			sql: `INSERT INTO print_jobs
			        (plate_id, spool_ids_used_json, started_at, completed_at, status,
			         actual_duration_seconds, failure_reason)
			      VALUES (?, ?, ?, ?, ?, ?, ?)`,
			params: [
				plate.id!,
				JSON.stringify(assignments),
				startedAt,
				completedAt,
				status,
				input.actualDurationSeconds ?? null,
				nullable(input.failureReason)
			]
		}
	];

	if (status !== 'cancelled') {
		for (const assignment of assignments) {
			if (assignment.weightGrams > 0) {
				statements.push(deductStatement(assignment.spoolId, assignment.weightGrams));
			}
		}

		const counter = status === 'success' ? 'printed' : 'failed';
		for (const part of plate.partsOnPlate as PartOnPlate[]) {
			if (part.quantityOnPlate > 0) {
				statements.push(incrementStatement(part.partId, counter, part.quantityOnPlate));
			}
		}
	}

	statements.push(touchStatement(plate.projectId));
	await transaction(statements);
}
