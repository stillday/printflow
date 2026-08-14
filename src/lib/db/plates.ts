import { execute, nullable, select, selectOne, transaction } from './index';
import type {
	FilamentRequirement,
	PartOnPlate,
	PrintPlate,
	PrintPlateDecoded
} from '$lib/types/schema';

interface PlateRow {
	id: number;
	project_id: number;
	name: string;
	file_name: string;
	estimated_time_seconds: number;
	layer_count: number | null;
	filament_requirements_json: string;
	parts_on_plate_json: string;
	source_path: string | null;
	created_at: string;
	// Only present on the list query — see `listPlates`.
	planned_count?: number;
	next_planned_date?: string | null;
}

/** Tolerates hand-edited or legacy JSON rather than throwing on render. */
function parseJson<T>(raw: string, fallback: T[]): T[] {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as T[]) : fallback;
	} catch {
		return fallback;
	}
}

function mapPlate(row: PlateRow): PrintPlateDecoded {
	return {
		id: row.id,
		projectId: row.project_id,
		name: row.name,
		fileName: row.file_name,
		estimatedTimeSeconds: row.estimated_time_seconds,
		layerCount: row.layer_count,
		filamentRequirementsJson: row.filament_requirements_json,
		partsOnPlateJson: row.parts_on_plate_json,
		sourcePath: row.source_path,
		createdAt: row.created_at,
		filamentRequirements: parseJson<FilamentRequirement>(row.filament_requirements_json, []),
		partsOnPlate: parseJson<PartOnPlate>(row.parts_on_plate_json, []),
		plannedCount: row.planned_count ?? 0,
		nextPlannedDate: row.next_planned_date ?? null
	};
}

/**
 * A project's plates, each carrying whether it is already on the print plan.
 *
 * Without this the plates view and the plan told different stories about the
 * same plate, and nothing stopped a user from scheduling one twice.
 */
export async function listPlates(projectId: number): Promise<PrintPlateDecoded[]> {
	const rows = await select<PlateRow>(
		`SELECT pl.*,
		        (SELECT COUNT(*) FROM print_plan_entries e
		          WHERE e.plate_id = pl.id AND e.status = 'planned')          AS planned_count,
		        (SELECT MIN(e.planned_date) FROM print_plan_entries e
		          WHERE e.plate_id = pl.id AND e.status = 'planned'
		            AND e.planned_date >= date('now', 'localtime'))            AS next_planned_date
		 FROM print_plates pl
		 WHERE pl.project_id = ?
		 ORDER BY pl.created_at, pl.id`,
		[projectId]
	);
	return rows.map(mapPlate);
}

/** Used by the print plan, which knows a plate only by id. */
export async function getPlate(id: number): Promise<PrintPlateDecoded | null> {
	const row = await selectOne<PlateRow>('SELECT * FROM print_plates WHERE id = ?', [id]);
	return row ? mapPlate(row) : null;
}

export async function createPlate(plate: PrintPlate): Promise<number> {
	const result = await execute(
		`INSERT INTO print_plates
		   (project_id, name, file_name, estimated_time_seconds, layer_count,
		    filament_requirements_json, parts_on_plate_json, source_path)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			plate.projectId,
			plate.name.trim(),
			plate.fileName,
			Math.round(plate.estimatedTimeSeconds),
			plate.layerCount ?? null,
			plate.filamentRequirementsJson,
			plate.partsOnPlateJson,
			nullable(plate.sourcePath)
		]
	);
	return Number(result.lastInsertId);
}

export async function renamePlate(id: number, name: string): Promise<void> {
	await execute('UPDATE print_plates SET name = ? WHERE id = ?', [name.trim(), id]);
}

export async function setPartsOnPlate(id: number, parts: PartOnPlate[]): Promise<void> {
	await execute('UPDATE print_plates SET parts_on_plate_json = ? WHERE id = ?', [
		JSON.stringify(parts),
		id
	]);
}

export async function deletePlate(id: number): Promise<void> {
	await execute('DELETE FROM print_plates WHERE id = ?', [id]);
}

/**
 * Sets which plates produce a part, from the part's side.
 *
 * The link lives in each plate's `parts_on_plate_json`, so editing it for one
 * part means patching several plates. That runs in one transaction: a half-
 * applied change would leave a part counted on some plates and not others, and
 * the print-job flow increments counters from exactly this data.
 *
 * Plates not mentioned in `entries` lose the part; a quantity of 0 removes it.
 */
export async function setPlatesForPart(
	projectId: number,
	partId: number,
	entries: { plateId: number; quantityOnPlate: number }[]
): Promise<void> {
	const plates = await listPlates(projectId);
	const wanted = new Map(entries.map((entry) => [entry.plateId, entry.quantityOnPlate]));

	const statements = plates.flatMap((plate) => {
		if (plate.id === undefined) return [];
		const quantity = wanted.get(plate.id) ?? 0;
		const next = plate.partsOnPlate.filter((entry) => entry.partId !== partId);
		if (quantity > 0) next.push({ partId, quantityOnPlate: quantity });

		const json = JSON.stringify(next);
		// Skip plates whose linkage did not change, so a small edit does not
		// rewrite every row in the project.
		if (json === JSON.stringify(plate.partsOnPlate)) return [];
		return [
			{
				sql: 'UPDATE print_plates SET parts_on_plate_json = ? WHERE id = ?',
				params: [json, plate.id]
			}
		];
	});

	await transaction(statements);
}

/** Total grams a plate consumes across all filament slots. */
export function plateTotalWeight(plate: PrintPlateDecoded): number {
	return plate.filamentRequirements.reduce((sum, req) => sum + (req.weightGrams || 0), 0);
}

/**
 * Where every already-imported file ended up, keyed by its absolute path.
 *
 * A `Map` rather than a `Set`: the library screen has to be able to say *which*
 * project a file is in and link there, and the lookup runs against thousands of
 * scanned rows.
 */
export async function listImportedPaths(): Promise<Map<string, ImportedPlate>> {
	const rows = await select<{
		source_path: string;
		project_id: number;
		project_title: string;
	}>(
		// The alias must not be `inner`: SQLite reads that as the start of an
		// INNER JOIN and the statement fails to parse — which silently broke the
		// whole file library, because the scan was awaited alongside it.
		// One row per path, and a *defined* one: the same file can be imported into
		// two projects, and a bare column under GROUP BY would let SQLite pick
		// either — so the link would point at whichever row it happened to take.
		// The earliest plate wins, which is the project the file first landed in.
		`SELECT pl.source_path, pl.project_id, p.title AS project_title
		 FROM print_plates pl
		 JOIN projects p ON p.id = pl.project_id
		 WHERE pl.source_path IS NOT NULL AND pl.source_path <> ''
		   AND pl.id = (SELECT MIN(earlier.id) FROM print_plates earlier
		                 WHERE earlier.source_path = pl.source_path)`
	);
	return new Map(
		rows.map((row) => [
			row.source_path,
			{ projectId: row.project_id, projectTitle: row.project_title }
		])
	);
}

export interface ImportedPlate {
	projectId: number;
	projectTitle: string;
}
