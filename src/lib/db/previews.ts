import { invoke } from '@tauri-apps/api/core';
import { execute, select, selectOne } from './index';

/**
 * A project's locally stored preview image.
 *
 * The image is fetched from the model page **once** by a Rust command and then
 * lives in the database, so the app keeps showing it with no network access. It
 * is rendered from a `data:` URI, which the existing Content-Security-Policy
 * already allows — the WebView never loads a remote image itself.
 */

export interface ProjectPreview {
	projectId: number;
	imageBase64: string;
	contentType: string;
	imageUrl: string | null;
	sourceUrl: string | null;
	fetchedAt: string;
}

interface PreviewRow {
	project_id: number;
	image_base64: string;
	content_type: string;
	image_url: string | null;
	source_url: string | null;
	fetched_at: string;
}

function mapPreview(row: PreviewRow): ProjectPreview {
	return {
		projectId: row.project_id,
		imageBase64: row.image_base64,
		contentType: row.content_type,
		imageUrl: row.image_url,
		sourceUrl: row.source_url,
		fetchedAt: row.fetched_at
	};
}

/** What an `<img src>` needs — the stored bytes, never a remote address. */
export function previewDataUri(preview: ProjectPreview): string {
	return `data:${preview.contentType};base64,${preview.imageBase64}`;
}

export async function getPreview(projectId: number): Promise<ProjectPreview | null> {
	const row = await selectOne<PreviewRow>('SELECT * FROM project_previews WHERE project_id = ?', [
		projectId
	]);
	return row ? mapPreview(row) : null;
}

/**
 * Which projects have a preview — for the project list, which must not pull the
 * images themselves just to decide whether to show a placeholder.
 */
export async function listProjectsWithPreview(): Promise<Set<number>> {
	const rows = await select<{ project_id: number }>('SELECT project_id FROM project_previews');
	return new Set(rows.map((row) => row.project_id));
}

export async function savePreview(preview: Omit<ProjectPreview, 'fetchedAt'>): Promise<void> {
	await execute(
		`INSERT INTO project_previews
		   (project_id, image_base64, content_type, image_url, source_url, fetched_at)
		 VALUES (?, ?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(project_id) DO UPDATE SET
		   image_base64 = excluded.image_base64,
		   content_type = excluded.content_type,
		   image_url    = excluded.image_url,
		   source_url   = excluded.source_url,
		   fetched_at   = excluded.fetched_at`,
		[
			preview.projectId,
			preview.imageBase64,
			preview.contentType,
			preview.imageUrl,
			preview.sourceUrl
		]
	);
}

export async function deletePreview(projectId: number): Promise<void> {
	await execute('DELETE FROM project_previews WHERE project_id = ?', [projectId]);
}

/* -------------------------------------------------------------------------- */
/* The one network call                                                       */
/* -------------------------------------------------------------------------- */

export interface FetchedPreview {
	imageBase64: string;
	contentType: string;
	imageUrl: string;
	/** The page's own title, offered as a project name. */
	title: string | null;
}

/**
 * Asks Rust to fetch a model page's preview image.
 *
 * Only reachable when the user enabled online features; the command itself
 * additionally restricts this to known model portals and enforces size limits
 * and a timeout, so the guarantees do not depend on the UI remembering to check.
 */
export function fetchModelPreview(url: string): Promise<FetchedPreview> {
	return invoke<FetchedPreview>('fetch_model_preview', { url });
}

/** Downloads a direct file URL into the user's model library. */
export function downloadFile(url: string, targetPath: string): Promise<number> {
	return invoke<number>('download_file', { url, targetPath });
}
