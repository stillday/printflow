import type { ScannedFile } from '$lib/db/library';
import { splitFolder } from './library';

/**
 * Works out how a model library is already organised.
 *
 * The point is not to classify for its own sake: a user who has spent years
 * arranging folders should not have to explain that arrangement to the app. If
 * one folder holds one model, then a folder *is* a project and the import can
 * say so; if everything sits in one heap, suggesting "one project per folder"
 * would be nonsense. So the shape decides what the app offers, and the wording
 * it offers it in.
 */

export type LibraryShape =
	/** Files sit directly in the chosen folder, with no structure to reuse. */
	| 'flat'
	/** One folder per model, files inside — the common maker layout. */
	| 'per-model'
	/** Category folders that contain model folders. */
	| 'categorised'
	/** Deep or uneven nesting that fits no single rule. */
	| 'mixed'
	/** Nothing found, so nothing to say. */
	| 'empty';

export interface LibraryAnalysis {
	shape: LibraryShape;
	fileCount: number;
	/** Folders that directly contain at least one slicer file. */
	folderCount: number;
	/** Files sitting directly in the scanned root. */
	rootFileCount: number;
	maxDepth: number;
	/** Median files per file-bearing folder — resistant to one huge folder. */
	medianFilesPerFolder: number;
	/** Depth at which most files live, which is where models sit. */
	dominantDepth: number;
	/**
	 * Top-level folders that contain only folders, no files. Under
	 * `categorised` these are the categories.
	 */
	categories: string[];
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? sorted[middle]
		: Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function analyseLibrary(files: ScannedFile[]): LibraryAnalysis {
	if (files.length === 0) {
		return {
			shape: 'empty',
			fileCount: 0,
			folderCount: 0,
			rootFileCount: 0,
			maxDepth: 0,
			medianFilesPerFolder: 0,
			dominantDepth: 0,
			categories: []
		};
	}

	const perFolder = new Map<string, number>();
	const perDepth = new Map<number, number>();
	/** Top-level segment → whether any file sits directly inside it. */
	const topLevel = new Map<string, boolean>();
	let rootFileCount = 0;
	let maxDepth = 0;

	for (const file of files) {
		const segments = splitFolder(file.folder);
		const depth = segments.length;
		maxDepth = Math.max(maxDepth, depth);
		perFolder.set(file.folder, (perFolder.get(file.folder) ?? 0) + 1);
		perDepth.set(depth, (perDepth.get(depth) ?? 0) + 1);

		if (depth === 0) {
			rootFileCount += 1;
		} else {
			const top = segments[0];
			// A top-level folder counts as a category only while nothing lies
			// directly in it — a file there means it is a model folder itself.
			topLevel.set(top, (topLevel.get(top) ?? false) || depth === 1);
		}
	}

	const dominantDepth = [...perDepth.entries()].sort(
		(a, b) => b[1] - a[1] || a[0] - b[0]
	)[0][0];
	const medianFilesPerFolder = median([...perFolder.values()]);
	const categories = [...topLevel.entries()]
		.filter(([, hasOwnFiles]) => !hasOwnFiles)
		.map(([name]) => name)
		.sort((a, b) => a.localeCompare(b));

	const analysis: Omit<LibraryAnalysis, 'shape'> = {
		fileCount: files.length,
		folderCount: perFolder.size,
		rootFileCount,
		maxDepth,
		medianFilesPerFolder,
		dominantDepth,
		categories
	};

	return { ...analysis, shape: classify(analysis) };
}

function classify(a: Omit<LibraryAnalysis, 'shape'>): LibraryShape {
	// Everything in the root, or near enough that structure is not the rule.
	if (a.maxDepth === 0) return 'flat';
	if (a.rootFileCount / a.fileCount > 0.7) return 'flat';

	// Most files two levels down and the top level holds only folders:
	// categories containing model folders.
	if (a.dominantDepth >= 2 && a.categories.length >= 2) return 'categorised';

	// One folder per model: most files one level down, and a folder holds a
	// handful of files rather than dozens.
	if (a.dominantDepth === 1 && a.medianFilesPerFolder <= 8) return 'per-model';

	// Deeper or uneven than either rule describes.
	return 'mixed';
}

/**
 * Whether a folder in this library is worth offering as a project name.
 *
 * Only where the folders actually correspond to models — offering "3D-Druck" as
 * a project name because everything happens to sit under it would be worse than
 * offering nothing.
 */
export function foldersAreProjects(shape: LibraryShape): boolean {
	return shape === 'per-model' || shape === 'categorised';
}
