import { addMessages, init, locale, waitLocale } from 'svelte-i18n';
import de from './locales/de.json';
import en from './locales/en.json';
import nl from './locales/nl.json';

export const SUPPORTED_LOCALES = ['de', 'en', 'nl'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'de';
export const FALLBACK_LOCALE: AppLocale = 'en';

/**
 * Dictionaries are bundled eagerly rather than lazily fetched: the whole app
 * ships offline and the files are a few kilobytes, so this trades a negligible
 * bundle increase for zero loading flicker on language switch.
 */
addMessages('de', de);
addMessages('en', en);
addMessages('nl', nl);

export function isSupportedLocale(value: unknown): value is AppLocale {
	return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Maps things like `de-AT`, `nl_BE` or `en-US` onto a supported locale. */
export function normalizeLocale(raw: string | null | undefined): AppLocale | null {
	if (!raw) return null;
	const base = raw.toLowerCase().replace('_', '-').split('-')[0];
	return isSupportedLocale(base) ? base : null;
}

export async function setupI18n(initialLocale: AppLocale) {
	init({ fallbackLocale: FALLBACK_LOCALE, initialLocale });
	await waitLocale();
}

export function setLocale(next: AppLocale) {
	locale.set(next);
	if (typeof document !== 'undefined') {
		document.documentElement.lang = next;
	}
}
