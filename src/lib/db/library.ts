import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

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
	/** A limit was hit, so the listing is incomplete. */
	truncated: boolean;
	/**
	 * The scan ran out of time. Almost always a network or cloud mount: walking
	 * one pays round-trip latency per directory, and a Google Drive folder can
	 * take minutes where a local disk takes a second.
	 */
	timedOut: boolean;
	foldersScanned: number;
}

export interface ScanProgress {
	foldersScanned: number;
	filesFound: number;
}

export interface ScanOptions {
	maxDepth?: number;
	limit?: number;
	timeoutSecs?: number;
}

export function scanSlicerFiles(root: string, options: ScanOptions = {}): Promise<ScanResult> {
	return invoke<ScanResult>('scan_slicer_files', {
		root,
		maxDepth: options.maxDepth,
		limit: options.limit,
		timeoutSecs: options.timeoutSecs
	});
}

/**
 * Subscribes to scan progress. Returns the unsubscribe function; call it when
 * the scan finishes, or the next one will report into a stale listener too.
 */
export function onScanProgress(handler: (progress: ScanProgress) => void) {
	return listen<ScanProgress>('scan-progress', (event) => handler(event.payload));
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
