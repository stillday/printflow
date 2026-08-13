import { locale as osLocale } from '@tauri-apps/plugin-os';
import { DEFAULT_LOCALE, normalizeLocale, setLocale, setupI18n, type AppLocale } from '$lib/i18n';
import { getDb } from '$lib/db';
import { SETTING_LOCALE, SETTING_THEME, getSetting, setSetting } from '$lib/db/settings';
import { DEFAULT_THEME, applyTheme, normalizeTheme } from '$lib/theme';
import { theme } from '$lib/stores/theme.svelte';

/** Best guess before the database is available, so the UI can always render. */
function guessLocale(): AppLocale {
	if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
	for (const candidate of navigator.languages ?? [navigator.language]) {
		const match = normalizeLocale(candidate);
		if (match) return match;
	}
	return DEFAULT_LOCALE;
}

/**
 * Two-phase startup:
 *
 *  1. i18n comes up immediately on a navigator-based guess, so even a database
 *     failure is reported in a language the user can read.
 *  2. The database opens (running migrations), then the stored language wins.
 *     On first start there is none, so the OS locale is detected and saved.
 */
export async function bootstrap(): Promise<void> {
	await setupI18n(guessLocale());

	// Paint in the default theme until the stored one is known — the database
	// opens in a few milliseconds, so this is cheaper than a blocking read.
	applyTheme(DEFAULT_THEME);

	await getDb();

	theme.init(normalizeTheme(await getSetting(SETTING_THEME)) ?? DEFAULT_THEME);

	const stored = normalizeLocale(await getSetting(SETTING_LOCALE));
	if (stored) {
		setLocale(stored);
		return;
	}

	let detected: AppLocale | null = null;
	try {
		detected = normalizeLocale(await osLocale());
	} catch {
		// Not fatal — fall back to what the WebView reports.
	}

	const initial = detected ?? guessLocale();
	setLocale(initial);
	await setSetting(SETTING_LOCALE, initial);
}
