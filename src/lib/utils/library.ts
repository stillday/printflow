import type { ScannedFile } from '$lib/db/library';
import type { ImportedPlate } from '$lib/db/plates';

/**
 * Turning a flat scan result into the folder view the UI shows.
 *
 * The scanner returns paths with the *platform's* separator, so nothing here may
 * assume `/`. Folders are compared and split on both.
 */

const SEPARATORS = /[/\\]/;

export interface FolderGroup {
	/** Folder relative to the scanned root; empty string for the root itself. */
	folder: string;
	/** Path split into its parts, so the UI can indent or show a breadcrumb. */
	segments: string[];
	files: ScannedFile[];
	totalBytes: number;
	/** How many of this folder's files are already in a project. */
	importedCount: number;
}

export function splitFolder(folder: string): string[] {
	return folder.split(SEPARATORS).filter(Boolean);
}

/**
 * Groups a scan by folder, keeping the scanner's order.
 *
 * In a model library the folder *is* the project — one folder per model, often
 * with the plates for its parts inside — so grouping by it is what makes a flat
 * list of a thousand files legible.
 *
 * `imported` is keyed by absolute path; only its keys matter here, the project
 * behind each one is what the row itself links to.
 */
export function groupByFolder(
	files: ScannedFile[],
	imported: ReadonlyMap<string, ImportedPlate>
): FolderGroup[] {
	const groups = new Map<string, FolderGroup>();

	for (const file of files) {
		let group = groups.get(file.folder);
		if (!group) {
			group = {
				folder: file.folder,
				segments: splitFolder(file.folder),
				files: [],
				totalBytes: 0,
				importedCount: 0
			};
			groups.set(file.folder, group);
		}
		group.files.push(file);
		group.totalBytes += Math.max(0, file.sizeBytes);
		if (imported.has(file.path)) group.importedCount += 1;
	}

	return Array.from(groups.values());
}

/**
 * Filters a scan by a free-text term, matched against file name and folder.
 *
 * Multiple words all have to match somewhere, in any order, so "table leg"
 * finds `Table/Legs/leg.3mf` the way a user expects.
 */
export function filterFiles(files: ScannedFile[], term: string): ScannedFile[] {
	const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return files;
	return files.filter((file) => {
		const haystack = `${file.folder} ${file.fileName}`.toLowerCase();
		return words.every((word) => haystack.includes(word));
	});
}

/**
 * A project name suggested for a folder: its last segment, which in a model
 * library is the model's own folder. Falls back to the file name.
 */
export function suggestProjectName(file: ScannedFile): string {
	const segments = splitFolder(file.folder);
	const last = segments[segments.length - 1];
	if (last) return last;
	return file.fileName.replace(/\.(gcode\.3mf|3mf|gcode|gco)$/i, '').trim() || file.fileName;
}
