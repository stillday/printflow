import { invoke } from '@tauri-apps/api/core';

/**
 * Opening a link in the app's own WebView would replace the UI with the remote
 * page, and PrintFlow has no browser chrome to get back with. Model links are
 * therefore handed to the OS browser by the `open_external` Rust command, which
 * accepts `http`/`https` only.
 */
export async function openExternal(url: string): Promise<void> {
	await invoke('open_external', { url });
}

/**
 * Whether a stored URL is safe to offer as a link.
 *
 * Input is validated when a project is saved, but a database restored from a
 * backup has never passed through that check — so anything that is not plain
 * `http(s)` is treated as not linkable and the button is simply not rendered.
 */
export function isExternalUrl(value: string | null | undefined): boolean {
	const trimmed = value?.trim();
	if (!trimmed) return false;
	try {
		const { protocol } = new URL(trimmed);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}
