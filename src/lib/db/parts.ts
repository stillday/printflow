import { execute, select } from './index';
import type { Part } from '$lib/types/schema';

interface PartRow {
	id: number;
	project_id: number;
	name: string;
	required_quantity: number;
	printed_quantity: number;
	failed_quantity: number;
	sort_order: number;
}

function mapPart(row: PartRow): Part {
	return {
		id: row.id,
		projectId: row.project_id,
		name: row.name,
		requiredQuantity: row.required_quantity,
		printedQuantity: row.printed_quantity,
		failedQuantity: row.failed_quantity,
		sortOrder: row.sort_order
	};
}

export async function listParts(projectId: number): Promise<Part[]> {
	const rows = await select<PartRow>(
		'SELECT * FROM parts WHERE project_id = ? ORDER BY sort_order, id',
		[projectId]
	);
	return rows.map(mapPart);
}

export async function createPart(part: Part): Promise<number> {
	const result = await execute(
		`INSERT INTO parts (project_id, name, required_quantity, printed_quantity, failed_quantity, sort_order)
		 VALUES (?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM parts WHERE project_id = ?), 0))`,
		[
			part.projectId,
			part.name.trim(),
			part.requiredQuantity,
			part.printedQuantity,
			part.failedQuantity,
			part.projectId
		]
	);
	return Number(result.lastInsertId);
}

export async function updatePart(part: Part): Promise<void> {
	if (!part.id) throw new Error('cannot update a part without an id');
	await execute(
		`UPDATE parts
		 SET name = ?, required_quantity = ?, printed_quantity = ?, failed_quantity = ?
		 WHERE id = ?`,
		[
			part.name.trim(),
			part.requiredQuantity,
			part.printedQuantity,
			part.failedQuantity,
			part.id
		]
	);
}

export async function deletePart(id: number): Promise<void> {
	await execute('DELETE FROM parts WHERE id = ?', [id]);
}

/**
 * Nudges a counter by `delta`, clamped to `>= 0` in SQL so the CHECK
 * constraint can never be violated by a rapid double click.
 */
export async function adjustPartCounter(
	id: number,
	counter: 'printed' | 'failed',
	delta: number
): Promise<void> {
	const column = counter === 'printed' ? 'printed_quantity' : 'failed_quantity';
	await execute(`UPDATE parts SET ${column} = MAX(0, ${column} + ?) WHERE id = ?`, [delta, id]);
}

/** Same increment as a statement, for the transactional print-job flow. */
export function incrementStatement(id: number, counter: 'printed' | 'failed', delta: number) {
	const column = counter === 'printed' ? 'printed_quantity' : 'failed_quantity';
	return {
		sql: `UPDATE parts SET ${column} = MAX(0, ${column} + ?) WHERE id = ?`,
		params: [delta, id]
	};
}
