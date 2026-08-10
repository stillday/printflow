import { execute, now, nullable, select, selectOne } from './index';
import { mapCatalog } from './catalog';
import type { Spool, SpoolStatus, SpoolWithCatalog } from '$lib/types/schema';

interface SpoolJoinRow {
	id: number;
	catalog_id: number;
	qr_or_bar_code: string | null;
	current_weight_net: number;
	cost: number;
	location: string | null;
	status: SpoolStatus;
	opened_at: string | null;
	created_at: string;
	// joined catalog columns, aliased to avoid clashing with the spool's own
	c_id: number;
	brand: string;
	material: string;
	name: string;
	color_hex: string;
	density: number;
	spool_tare_weight: number;
	nominal_weight: number;
	printing_temp_min: number | null;
	printing_temp_max: number | null;
	c_created_at: string;
}

const JOIN_SELECT = `
	SELECT s.*,
	       c.id                AS c_id,
	       c.brand, c.material, c.name, c.color_hex, c.density,
	       c.spool_tare_weight, c.nominal_weight,
	       c.printing_temp_min, c.printing_temp_max,
	       c.created_at        AS c_created_at
	FROM spools s
	JOIN filament_catalog c ON c.id = s.catalog_id`;

function mapSpool(row: SpoolJoinRow): SpoolWithCatalog {
	return {
		id: row.id,
		catalogId: row.catalog_id,
		qrOrBarCode: row.qr_or_bar_code,
		currentWeightNet: row.current_weight_net,
		cost: row.cost,
		location: row.location,
		status: row.status,
		openedAt: row.opened_at,
		createdAt: row.created_at,
		catalog: mapCatalog({
			id: row.c_id,
			brand: row.brand,
			material: row.material,
			name: row.name,
			color_hex: row.color_hex,
			density: row.density,
			spool_tare_weight: row.spool_tare_weight,
			nominal_weight: row.nominal_weight,
			printing_temp_min: row.printing_temp_min,
			printing_temp_max: row.printing_temp_max,
			created_at: row.c_created_at
		})
	};
}

export async function listSpools(): Promise<SpoolWithCatalog[]> {
	const rows = await select<SpoolJoinRow>(
		`${JOIN_SELECT}
		 ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'empty' THEN 1 ELSE 2 END,
		          c.brand COLLATE NOCASE, c.name COLLATE NOCASE`
	);
	return rows.map(mapSpool);
}

export async function listActiveSpools(): Promise<SpoolWithCatalog[]> {
	const rows = await select<SpoolJoinRow>(
		`${JOIN_SELECT}
		 WHERE s.status = 'active'
		 ORDER BY c.material COLLATE NOCASE, s.current_weight_net DESC`
	);
	return rows.map(mapSpool);
}

export async function getSpool(id: number): Promise<SpoolWithCatalog | null> {
	const row = await selectOne<SpoolJoinRow>(`${JOIN_SELECT} WHERE s.id = ?`, [id]);
	return row ? mapSpool(row) : null;
}

export async function createSpool(spool: Spool): Promise<number> {
	const result = await execute(
		`INSERT INTO spools
		   (catalog_id, qr_or_bar_code, current_weight_net, cost, location, status, opened_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			spool.catalogId,
			nullable(spool.qrOrBarCode),
			spool.currentWeightNet,
			spool.cost,
			nullable(spool.location),
			spool.status,
			spool.openedAt ?? now()
		]
	);
	return Number(result.lastInsertId);
}

export async function updateSpool(spool: Spool): Promise<void> {
	if (!spool.id) throw new Error('cannot update a spool without an id');
	await execute(
		`UPDATE spools
		 SET catalog_id = ?, qr_or_bar_code = ?, current_weight_net = ?, cost = ?,
		     location = ?, status = ?, opened_at = ?
		 WHERE id = ?`,
		[
			spool.catalogId,
			nullable(spool.qrOrBarCode),
			spool.currentWeightNet,
			spool.cost,
			nullable(spool.location),
			spool.status,
			spool.openedAt ?? null,
			spool.id
		]
	);
}

export async function deleteSpool(id: number): Promise<void> {
	await execute('DELETE FROM spools WHERE id = ?', [id]);
}

export async function setSpoolStatus(id: number, status: SpoolStatus): Promise<void> {
	await execute('UPDATE spools SET status = ? WHERE id = ?', [status, id]);
}

/**
 * Subtracts `grams` from a spool, clamped at zero, and flips it to `empty`
 * once nothing is left. Clamping happens in SQL so a concurrent read can never
 * observe a negative stock.
 */
export async function deductFromSpool(id: number, grams: number): Promise<void> {
	await execute(
		`UPDATE spools
		 SET current_weight_net = MAX(0, current_weight_net - ?),
		     status = CASE WHEN MAX(0, current_weight_net - ?) <= 0 AND status = 'active'
		                   THEN 'empty' ELSE status END
		 WHERE id = ?`,
		[grams, grams, id]
	);
}

/** SQL for the same deduction, for use inside a multi-statement transaction. */
export function deductStatement(id: number, grams: number) {
	return {
		sql: `UPDATE spools
		      SET current_weight_net = MAX(0, current_weight_net - ?),
		          status = CASE WHEN MAX(0, current_weight_net - ?) <= 0 AND status = 'active'
		                        THEN 'empty' ELSE status END
		      WHERE id = ?`,
		params: [grams, grams, id]
	};
}

export async function listLocations(): Promise<string[]> {
	const rows = await select<{ location: string }>(
		`SELECT DISTINCT location FROM spools
		 WHERE location IS NOT NULL AND TRIM(location) <> ''
		 ORDER BY location COLLATE NOCASE`
	);
	return rows.map((r) => r.location);
}
