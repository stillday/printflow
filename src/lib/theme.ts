/**
 * Light/dark theming.
 *
 * The whole UI is built from Tailwind's zinc ramp plus a few accent shades, and
 * Tailwind v4 compiles every one of those to a `var(--color-…)` reference. So
 * instead of annotating hundreds of class names with `dark:` variants, the light
 * theme redefines those variables under `:root[data-theme='light']` in
 * `app.css` — this module only decides which value the attribute carries.
 */

export const THEMES = ['system', 'dark', 'light'] as const;
export type ThemePreference = (typeof THEMES)[number];
export type ResolvedTheme = 'dark' | 'light';

export const DEFAULT_THEME: ThemePreference = 'dark';

export function isThemePreference(value: unknown): value is ThemePreference {
	return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export function normalizeTheme(raw: string | null | undefined): ThemePreference | null {
	return isThemePreference(raw) ? raw : null;
}

/** What the OS asks for; falls back to dark where nothing can be detected. */
export function systemTheme(): ResolvedTheme {
	if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
	return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
	return preference === 'system' ? systemTheme() : preference;
}

/**
 * Writes the resolved theme onto `<html>`, which is what the CSS keys off.
 * `color-scheme` comes along so the platform styles date pickers, `<select>`
 * popups and scrollbars to match.
 */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
	const resolved = resolveTheme(preference);
	if (typeof document !== 'undefined') {
		const root = document.documentElement;
		root.dataset.theme = resolved;
		root.style.colorScheme = resolved;
		// Tailwind's own `dark:` variant keys off this class, so keep it honest
		// even though the app currently themes through variables.
		root.classList.toggle('dark', resolved === 'dark');
	}
	return resolved;
}

/**
 * Keeps a `system` preference in step with the OS while the app is running.
 * Returns a teardown function; a no-op when the preference is explicit.
 */
export function watchSystemTheme(
	preference: ThemePreference,
	onChange: (resolved: ResolvedTheme) => void
): () => void {
	if (preference !== 'system' || typeof window === 'undefined' || !window.matchMedia) {
		return () => {};
	}
	const query = window.matchMedia('(prefers-color-scheme: light)');
	const listener = () => onChange(applyTheme('system'));
	query.addEventListener('change', listener);
	return () => query.removeEventListener('change', listener);
}
