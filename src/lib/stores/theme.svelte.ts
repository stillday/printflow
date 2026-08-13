import { SETTING_THEME, setSetting } from '$lib/db/settings';
import {
	DEFAULT_THEME,
	applyTheme,
	watchSystemTheme,
	type ResolvedTheme,
	type ThemePreference
} from '$lib/theme';

/**
 * The active theme preference, so the switcher can show what is selected and
 * components can branch on the resolved value when CSS alone will not do.
 */
class ThemeStore {
	preference = $state<ThemePreference>(DEFAULT_THEME);
	/** What `preference` currently means — `system` follows the OS. */
	resolved = $state<ResolvedTheme>('dark');

	#unwatch: () => void = () => {};

	/** Applies a preference read from the database, without writing it back. */
	init(preference: ThemePreference) {
		this.preference = preference;
		this.resolved = applyTheme(preference);
		this.#watch();
	}

	/** Applies a user choice and remembers it. */
	async set(preference: ThemePreference) {
		this.preference = preference;
		this.resolved = applyTheme(preference);
		this.#watch();
		await setSetting(SETTING_THEME, preference);
	}

	/** Only a `system` preference needs to track the OS. */
	#watch() {
		this.#unwatch();
		this.#unwatch = watchSystemTheme(this.preference, (resolved) => {
			this.resolved = resolved;
		});
	}
}

export const theme = new ThemeStore();
