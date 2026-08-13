import { execute, nullable, select, selectOne, transaction } from './index';
import type { FilamentRequirement, PlanEntryDecoded, PlanStatus } from '$lib/types/schema';

interface PlanRow {
	id: number;
	plate_id: number;
	planned_date: string;
	position: number;
	status: PlanStatus;
	note: string | null;
	job_id: number | null;
	created_at: string;
	// joined
	plate_name: string;
	project_id: number;
	project_title: string;
	estimated_time_seconds: number;
	filament_requirements_json: string;
}

const JOIN_SELECT = `
	SELECT e.*,
	       pl.name                       AS plate_name,
	       pl.project_id                 AS project_id,
	       pl.estimated_time_seconds     AS estimated_time_seconds,
	       pl.filament_requirements_json AS filament_requirements_json,
	       p.title                       AS project_title
	FROM print_plan_entries e
	JOIN print_plates pl ON pl.id = e.plate_id
	JOIN projects p      ON p.id  = pl.project_id`;

/** Day order first, then the queue position the user arranged. */
const ORDER_BY = 'ORDER BY e.planned_date, e.position, e.id';

function mapEntry(row: PlanRow): PlanEntryDecoded {
	let filamentRequirements: FilamentRequirement[] = [];
	try {
		const parsed = JSON.parse(row.filament_requirements_json);
		if (Array.isArray(parsed)) filamentRequirements = parsed;
	} catch {
		filamentRequirements = [];
	}
	return {
		id: row.id,
		plateId: row.plate_id,
		plannedDate: row.planned_date,
		position: row.position,
		status: row.status,
		note: row.note,
		jobId: row.job_id,
		createdAt: row.created_at,
		plateName: row.plate_name,
		projectId: row.project_id,
		projectTitle: row.project_title,
		estimatedTimeSeconds: row.estimated_time_seconds,
		filamentRequirements
	};
}

/** Everything planned between two calendar dates, both ends included. */
export async function listPlanRange(from: string, to: string): Promise<PlanEntryDecoded[]> {
	const rows = await select<PlanRow>(
		`${JOIN_SELECT} WHERE e.planned_date BETWEEN ? AND ? ${ORDER_BY}`,
		[from, to]
	);
	return rows.map(mapEntry);
}

/**
 * Still-open entries whose day has passed. These are the ones that would
 * silently disappear from a week view, so the plan page shows them separately.
 */
export async function listOverdue(today: string): Promise<PlanEntryDecoded[]> {
	const rows = await select<PlanRow>(
		`${JOIN_SELECT} WHERE e.status = 'planned' AND e.planned_date < ? ${ORDER_BY}`,
		[today]
	);
	return rows.map(mapEntry);
}

/** The next open entry from `today` on — for the dashboard tile. */
export async function nextPlanned(today: string): Promise<PlanEntryDecoded | null> {
	const row = await selectOne<PlanRow>(
		`${JOIN_SELECT}
		 WHERE e.status = 'planned' AND e.planned_date >= ?
		 ORDER BY e.planned_date, e.position, e.id
		 LIMIT 1`,
		[today]
	);
	return row ? mapEntry(row) : null;
}

/** Appends a plate to the end of a day's queue. */
export async function createEntry(
	plateId: number,
	plannedDate: string,
	note?: string | null
): Promise<number> {
	const result = await execute(
		`INSERT INTO print_plan_entries (plate_id, planned_date, position, status, note)
		 VALUES (
		   ?, ?,
		   COALESCE((SELECT MAX(position) + 1 FROM print_plan_entries WHERE planned_date = ?), 0),
		   'planned', ?
		 )`,
		[plateId, plannedDate, plannedDate, nullable(note)]
	);
	return Number(result.lastInsertId);
}

/** Moves an entry to another day, appended at the end of that day's queue. */
export async function moveToDate(id: number, plannedDate: string): Promise<void> {
	await execute(
		`UPDATE print_plan_entries
		 SET planned_date = ?,
		     position = COALESCE(
		       (SELECT MAX(position) + 1 FROM print_plan_entries WHERE planned_date = ? AND id <> ?),
		       0
		     )
		 WHERE id = ?`,
		[plannedDate, plannedDate, id, id]
	);
}

/** Writes a whole day's order in one go, so no intermediate state is visible. */
export async function setPositions(ordered: { id: number; position: number }[]): Promise<void> {
	if (ordered.length === 0) return;
	await transaction(
		ordered.map(({ id, position }) => ({
			sql: 'UPDATE print_plan_entries SET position = ? WHERE id = ?',
			params: [position, id]
		}))
	);
}

export async function setStatus(id: number, status: PlanStatus): Promise<void> {
	await execute('UPDATE print_plan_entries SET status = ? WHERE id = ?', [status, id]);
}

export async function deleteEntry(id: number): Promise<void> {
	await execute('DELETE FROM print_plan_entries WHERE id = ?', [id]);
}

/**
 * SQL that closes a plan entry as `done` and links it to the job row inserted
 * immediately before it in the same transaction.
 *
 * `last_insert_rowid()` is per connection and the surrounding transaction holds
 * the write lock, so this is the job that was just written — but only as long as
 * this statement stays directly after the INSERT, before any other insert.
 */
export function completeStatement(id: number) {
	return {
		sql: `UPDATE print_plan_entries
		      SET status = 'done', job_id = last_insert_rowid()
		      WHERE id = ?`,
		params: [id]
	};
}
