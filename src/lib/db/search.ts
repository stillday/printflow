import { select } from './index';

export type SearchKind = 'project' | 'part' | 'plate' | 'spool' | 'catalog';

export interface SearchHit {
	kind: SearchKind;
	id: number;
	title: string;
	/** Plain text detail line. */
	subtitle?: string;
	/** i18n key rendered instead of `subtitle` when set. */
	subtitleKey?: string;
	colorHex?: string;
	href: string;
}

/** `LIKE` needs its wildcards escaped or a user's `%` matches everything. */
function likePattern(term: string): string {
	return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Quick search across projects, their parts and plates, spools and the catalog.
 * Deliberately a single round trip per entity rather than a FTS index — the
 * data set of a personal workshop is small and this keeps the schema simple.
 *
 * Parts and plates are what a user actually remembers by name ("Scharnier",
 * "Halter_v2.3mf"); both carry their project title so two identically named
 * parts in different assemblies stay tellable apart.
 */
export async function quickSearch(term: string, limitPerKind = 5): Promise<SearchHit[]> {
	const trimmed = term.trim();
	if (trimmed.length < 2) return [];
	const pattern = likePattern(trimmed);

	const [projects, parts, plates, spools, catalog] = await Promise.all([
		select<{ id: number; title: string; status: string }>(
			`SELECT id, title, status FROM projects
			 WHERE title LIKE ? ESCAPE '\\' OR IFNULL(description, '') LIKE ? ESCAPE '\\'
			 ORDER BY updated_at DESC LIMIT ?`,
			[pattern, pattern, limitPerKind]
		),
		select<{ id: number; name: string; project_id: number; project_title: string }>(
			`SELECT p.id, p.name, p.project_id, j.title AS project_title
			 FROM parts p JOIN projects j ON j.id = p.project_id
			 WHERE p.name LIKE ? ESCAPE '\\'
			 ORDER BY j.updated_at DESC, p.sort_order LIMIT ?`,
			[pattern, limitPerKind]
		),
		select<{
			id: number;
			name: string;
			file_name: string;
			project_id: number;
			project_title: string;
		}>(
			`SELECT t.id, t.name, t.file_name, t.project_id, j.title AS project_title
			 FROM print_plates t JOIN projects j ON j.id = t.project_id
			 WHERE t.name LIKE ? ESCAPE '\\' OR t.file_name LIKE ? ESCAPE '\\'
			 ORDER BY t.created_at DESC LIMIT ?`,
			[pattern, pattern, limitPerKind]
		),
		select<{
			id: number;
			brand: string;
			name: string;
			material: string;
			color_hex: string;
			location: string | null;
		}>(
			`SELECT s.id, c.brand, c.name, c.material, c.color_hex, s.location
			 FROM spools s JOIN filament_catalog c ON c.id = s.catalog_id
			 WHERE c.brand LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\'
			    OR c.material LIKE ? ESCAPE '\\' OR IFNULL(s.location, '') LIKE ? ESCAPE '\\'
			    OR IFNULL(s.qr_or_bar_code, '') LIKE ? ESCAPE '\\'
			 ORDER BY s.status, c.brand LIMIT ?`,
			[pattern, pattern, pattern, pattern, pattern, limitPerKind]
		),
		select<{ id: number; brand: string; name: string; material: string; color_hex: string }>(
			`SELECT id, brand, name, material, color_hex FROM filament_catalog
			 WHERE brand LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR material LIKE ? ESCAPE '\\'
			 ORDER BY brand LIMIT ?`,
			[pattern, pattern, pattern, limitPerKind]
		)
	]);

	return [
		...projects.map((row): SearchHit => ({
			kind: 'project',
			id: row.id,
			title: row.title,
			subtitleKey: `status.${row.status}`,
			href: `/projects/${row.id}`
		})),
		...parts.map((row): SearchHit => ({
			kind: 'part',
			id: row.id,
			title: row.name,
			subtitle: row.project_title,
			// Parts have no page of their own — they live in their project's list.
			href: `/projects/${row.project_id}`
		})),
		...plates.map((row): SearchHit => ({
			kind: 'plate',
			id: row.id,
			title: row.name,
			// A plate is often renamed after import, so a hit on the file name
			// would otherwise show nothing the user recognises.
			subtitle:
				row.file_name && row.file_name !== row.name
					? `${row.project_title} — ${row.file_name}`
					: row.project_title,
			href: `/projects/${row.project_id}`
		})),
		...spools.map((row): SearchHit => ({
			kind: 'spool',
			id: row.id,
			title: `${row.brand} · ${row.name}`,
			subtitle: row.location ? `${row.material} — ${row.location}` : row.material,
			colorHex: row.color_hex,
			href: `/spools?spool=${row.id}`
		})),
		...catalog.map((row): SearchHit => ({
			kind: 'catalog',
			id: row.id,
			title: `${row.brand} · ${row.name}`,
			subtitle: row.material,
			colorHex: row.color_hex,
			href: `/catalog?entry=${row.id}`
		}))
	];
}
