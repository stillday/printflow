import { invoke } from '@tauri-apps/api/core';

/**
 * Browsing slicer files that live on disk, outside the database.
 *
 * The walk and the file reads happen in Rust: it is far faster than crossing the
 * IPC boundary per directory, and both commands validate what they touch, so the
 * WebView never gets a general-purpose filesystem.
 */

export interface ScannedFile {
	/** Absolute path — the identity of the file everywhere else. */
	path: string;
	fileName: string;
	/** Directory relative to the scanned root; empty for files in the root. */
	folder: string;
	sizeBytes: number;
	/** Unix seconds, or null when the platform does not report it. */
	modifiedAt: number | null;
}

export interface ScanResult {
	root: string;
	files: ScannedFile[];
	/** The limit was hit, so the listing is incomplete. */
	truncated: boolean;
}

export interface ScanOptions {
	maxDepth?: number;
	limit?: number;
}

export function scanSlicerFiles(root: string, options: ScanOptions = {}): Promise<ScanResult> {
	return invoke<ScanResult>('scan_slicer_files', {
		root,
		maxDepth: options.maxDepth,
		limit: options.limit
	});
}

/**
 * Reads a slicer file from disk as a `File`, so the existing `.3mf`/G-code
 * parser — which is written against the browser file API — can work on it
 * unchanged.
 */
export async function readSlicerFile(path: string, fileName: string): Promise<File> {
	const bytes = await invoke<number[]>('read_slicer_file', { path });
	return new File([new Uint8Array(bytes)], fileName);
}
