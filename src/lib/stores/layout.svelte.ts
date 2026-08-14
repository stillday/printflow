import { SETTING_LAYOUT, setSetting } from '$lib/db/settings';
import { DEFAULT_LAYOUT, applyLayout, usesIconRail, type Layout } from '$lib/layout';

/**
 * The chosen layout density.
 *
 * Mirrors the theme store deliberately: both are a single stored string applied
 * as an attribute on `<html>`, and keeping them shaped alike means there is one
 * pattern to understand rather than two.
 */
class LayoutStore {
	current = $state<Layout>(DEFAULT_LAYOUT);

	/** True when the sidebar collapses to an icon rail — the one thing the CSS
	 *  variables cannot express, because it changes what is rendered. */
	get iconRail(): boolean {
		return usesIconRail(this.current);
	}

	/** Applies a value read from the database, without writing it back. */
	init(layout: Layout) {
		this.current = layout;
		applyLayout(layout);
	}

	/**
	 * Applies a user choice and remembers it. Persist first, so a failed write
	 * cannot leave the running app disagreeing with what the next start will read.
	 */
	async set(layout: Layout) {
		await setSetting(SETTING_LAYOUT, layout);
		this.current = layout;
		applyLayout(layout);
	}
}

export const layout = new LayoutStore();
