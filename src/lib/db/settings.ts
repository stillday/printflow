import { execute, select, selectOne } from './index';

export async function getSetting(key: string): Promise<string | null> {
	const row = await selectOne<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [
		key
	]);
	return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
	await execute(
		`INSERT INTO app_settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		[key, value]
	);
}

export const SETTING_LOCALE = 'locale';
export const SETTING_THEME = 'theme';
export const SETTING_LIBRARY_ROOT = 'libraryRoot';

export interface DataSummary {
	catalog: number;
	spools: number;
	projects: number;
	parts: number;
	plates: number;
	jobs: number;
}

export async function getDataSummary(): Promise<DataSummary> {
	const [row] = await select<DataSummary>(
		`SELECT (SELECT COUNT(*) FROM filament_catalog) AS catalog,
		        (SELECT COUNT(*) FROM spools)           AS spools,
		        (SELECT COUNT(*) FROM projects)         AS projects,
		        (SELECT COUNT(*) FROM parts)            AS parts,
		        (SELECT COUNT(*) FROM print_plates)     AS plates,
		        (SELECT COUNT(*) FROM print_jobs)       AS jobs`
	);
	return row ?? { catalog: 0, spools: 0, projects: 0, parts: 0, plates: 0, jobs: 0 };
}

export interface DashboardStats {
	activeSpools: number;
	filamentStockGrams: number;
	openProjects: number;
	partsToPrint: number;
	plannedSeconds: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
	const [row] = await select<{
		active_spools: number;
		stock: number;
		open_projects: number;
		parts_to_print: number;
		planned_seconds: number;
	}>(
		`SELECT (SELECT COUNT(*) FROM spools WHERE status = 'active')                       AS active_spools,
		        (SELECT COALESCE(SUM(current_weight_net), 0) FROM spools WHERE status = 'active') AS stock,
		        (SELECT COUNT(*) FROM projects WHERE status IN ('planning', 'in_progress'))  AS open_projects,
		        (SELECT COALESCE(SUM(MAX(0, required_quantity - printed_quantity)), 0)
		         FROM parts pt
		         JOIN projects p ON p.id = pt.project_id
		         WHERE p.status IN ('planning', 'in_progress'))                              AS parts_to_print,
		        (SELECT COALESCE(SUM(pl.estimated_time_seconds), 0)
		         FROM print_plates pl
		         JOIN projects p ON p.id = pl.project_id
		         WHERE p.status IN ('planning', 'in_progress'))                              AS planned_seconds`
	);
	return {
		activeSpools: row?.active_spools ?? 0,
		filamentStockGrams: row?.stock ?? 0,
		openProjects: row?.open_projects ?? 0,
		partsToPrint: row?.parts_to_print ?? 0,
		plannedSeconds: row?.planned_seconds ?? 0
	};
}
