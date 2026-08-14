/**
 * Layout density, chosen by the user.
 *
 * Same mechanism as the theme: the whole thing is CSS variables, so a layout is
 * an attribute on `<html>` rather than a fork in the markup. What differs
 * between the three is type scale, padding, radius and how the navigation is
 * presented — see the `:root[data-layout=…]` blocks in `app.css`.
 *
 * Offering this at all has a solid precedent: Apple ships a user-selectable
 * sidebar density (small / medium / large) in System Settings, and the case for
 * `workbench` — a narrow rail plus a list pane — is Apple's own advice for data
 * more than two levels deep, which a project → plate → part hierarchy is.
 */

export const LAYOUTS = ['console', 'studio', 'workbench'] as const;
export type Layout = (typeof LAYOUTS)[number];

/** Dense enough for a tool you keep open, which is what this app is. */
export const DEFAULT_LAYOUT: Layout = 'console';

export function isLayout(value: unknown): value is Layout {
	return typeof value === 'string' && (LAYOUTS as readonly string[]).includes(value);
}

export function normalizeLayout(raw: string | null | undefined): Layout | null {
	return isLayout(raw) ? raw : null;
}

/**
 * Whether this layout collapses the sidebar to an icon rail. The only piece the
 * variables cannot express on their own, because it changes what is rendered
 * rather than how big it is.
 */
export function usesIconRail(layout: Layout): boolean {
	return layout === 'workbench';
}

export function applyLayout(layout: Layout): void {
	if (typeof document === 'undefined') return;
	document.documentElement.dataset.layout = layout;
}
