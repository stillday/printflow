import { execute, now, nullable, select, selectOne } from './index';
import type { Project, ProjectStatus, ProjectWithProgress } from '$lib/types/schema';

interface ProjectRow {
	id: number;
	title: string;
	description: string | null;
	source_url: string | null;
	status: ProjectStatus;
	created_at: string;
	updated_at: string;
}

interface ProjectProgressRow extends ProjectRow {
	part_count: number;
	required_total: number;
	printed_total: number;
	failed_total: number;
}

function mapProject(row: ProjectRow): Project {
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		sourceUrl: row.source_url,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

const PROGRESS_SELECT = `
	SELECT p.*,
	       COUNT(pt.id)                          AS part_count,
	       COALESCE(SUM(pt.required_quantity), 0) AS required_total,
	       COALESCE(SUM(pt.printed_quantity), 0)  AS printed_total,
	       COALESCE(SUM(pt.failed_quantity), 0)   AS failed_total
	FROM projects p
	LEFT JOIN parts pt ON pt.project_id = p.id`;

function mapProgress(row: ProjectProgressRow): ProjectWithProgress {
	return {
		...mapProject(row),
		partCount: row.part_count,
		requiredTotal: row.required_total,
		printedTotal: row.printed_total,
		failedTotal: row.failed_total
	};
}

export async function listProjects(): Promise<ProjectWithProgress[]> {
	const rows = await select<ProjectProgressRow>(
		`${PROGRESS_SELECT} GROUP BY p.id ORDER BY p.updated_at DESC`
	);
	return rows.map(mapProgress);
}

export async function listRecentProjects(limit = 4): Promise<ProjectWithProgress[]> {
	const rows = await select<ProjectProgressRow>(
		`${PROGRESS_SELECT}
		 WHERE p.status IN ('planning', 'in_progress')
		 GROUP BY p.id
		 ORDER BY p.updated_at DESC
		 LIMIT ?`,
		[limit]
	);
	return rows.map(mapProgress);
}

export async function getProject(id: number): Promise<Project | null> {
	const row = await selectOne<ProjectRow>('SELECT * FROM projects WHERE id = ?', [id]);
	return row ? mapProject(row) : null;
}

export async function createProject(project: Project): Promise<number> {
	const timestamp = now();
	const result = await execute(
		`INSERT INTO projects (title, description, source_url, status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		[
			project.title.trim(),
			nullable(project.description),
			nullable(project.sourceUrl),
			project.status,
			timestamp,
			timestamp
		]
	);
	return Number(result.lastInsertId);
}

export async function updateProject(project: Project): Promise<void> {
	if (!project.id) throw new Error('cannot update a project without an id');
	await execute(
		`UPDATE projects
		 SET title = ?, description = ?, source_url = ?, status = ?, updated_at = ?
		 WHERE id = ?`,
		[
			project.title.trim(),
			nullable(project.description),
			nullable(project.sourceUrl),
			project.status,
			now(),
			project.id
		]
	);
}

export async function deleteProject(id: number): Promise<void> {
	await execute('DELETE FROM projects WHERE id = ?', [id]);
}

/** Keeps `updated_at` meaningful when child rows (parts, plates) change. */
export async function touchProject(id: number): Promise<void> {
	await execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now(), id]);
}

export function touchStatement(id: number) {
	return { sql: 'UPDATE projects SET updated_at = ? WHERE id = ?', params: [now(), id] };
}
