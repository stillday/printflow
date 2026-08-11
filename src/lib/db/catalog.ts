import { execute, select } from './index';
import type { FilamentCatalog } from '$lib/types/schema';

interface CatalogRow {
	id: number;
	brand: string;
	material: string;
	name: string;
	color_hex: string;
	density: number;
	spool_tare_weight: number;
	nominal_weight: number;
	printing_temp_min: number | null;
	printing_temp_max: number | null;
	created_at: string;
}

export function mapCatalog(row: CatalogRow): FilamentCatalog {
	return {
		id: row.id,
		brand: row.brand,
		material: row.material,
		name: row.name,
		colorHex: row.color_hex,
		density: row.density,
		spoolTareWeight: row.spool_tare_weight,
		nominalWeight: row.nominal_weight,
		printingTempMin: row.printing_temp_min,
		printingTempMax: row.printing_temp_max,
		createdAt: row.created_at
	};
}

/** Catalog entries with a live count of the spools referencing them. */
export interface CatalogWithUsage extends FilamentCatalog {
	spoolCount: number;
	activeSpoolCount: number;
	totalRemaining: number;
}

export async function listCatalog(): Promise<CatalogWithUsage[]> {
	const rows = await select<CatalogRow & { spool_count: number; active_count: number; remaining: number }>(
		`SELECT c.*,
		        COUNT(s.id)                                                        AS spool_count,
		        COALESCE(SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END), 0)  AS active_count,
		        COALESCE(SUM(CASE WHEN s.status = 'active' THEN s.current_weight_net ELSE 0 END), 0) AS remaining
		 FROM filament_catalog c
		 LEFT JOIN spools s ON s.catalog_id = c.id
		 GROUP BY c.id
		 ORDER BY c.brand COLLATE NOCASE, c.material COLLATE NOCASE, c.name COLLATE NOCASE`
	);
	return rows.map((row) => ({
		...mapCatalog(row),
		spoolCount: row.spool_count,
		activeSpoolCount: row.active_count,
		totalRemaining: row.remaining
	}));
}

export async function createCatalog(entry: FilamentCatalog): Promise<number> {
	const result = await execute(
		`INSERT INTO filament_catalog
		   (brand, material, name, color_hex, density, spool_tare_weight, nominal_weight,
		    printing_temp_min, printing_temp_max)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			entry.brand.trim(),
			entry.material.trim(),
			entry.name.trim(),
			entry.colorHex,
			entry.density,
			entry.spoolTareWeight,
			entry.nominalWeight,
			entry.printingTempMin ?? null,
			entry.printingTempMax ?? null
		]
	);
	return Number(result.lastInsertId);
}

export async function updateCatalog(entry: FilamentCatalog): Promise<void> {
	if (!entry.id) throw new Error('cannot update a catalog entry without an id');
	await execute(
		`UPDATE filament_catalog
		 SET brand = ?, material = ?, name = ?, color_hex = ?, density = ?,
		     spool_tare_weight = ?, nominal_weight = ?, printing_temp_min = ?, printing_temp_max = ?
		 WHERE id = ?`,
		[
			entry.brand.trim(),
			entry.material.trim(),
			entry.name.trim(),
			entry.colorHex,
			entry.density,
			entry.spoolTareWeight,
			entry.nominalWeight,
			entry.printingTempMin ?? null,
			entry.printingTempMax ?? null,
			entry.id
		]
	);
}

export async function deleteCatalog(id: number): Promise<void> {
	await execute('DELETE FROM filament_catalog WHERE id = ?', [id]);
}
