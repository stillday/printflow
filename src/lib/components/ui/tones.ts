/**
 * The app's tinted-surface palette, in one place.
 *
 * The same four accent triples (border / fill / text) drive the 36px icon tiles
 * in `StatTile` and `SectionCard`, the status pills and the chips. They used to
 * be copy-pasted per component, which meant a tone tweak had to be found in
 * three files — and `StatusPill`'s copy had already drifted into a different
 * class order. One map, imported everywhere.
 *
 * Every value stays on the Tailwind zinc/accent scales rather than hex, so the
 * light theme keeps working: it re-themes the app by redefining those colour
 * variables, and alpha fills like `bg-indigo-500/10` sit correctly on either
 * surface.
 */
export type Tone = 'indigo' | 'emerald' | 'amber' | 'rose' | 'zinc';

export const toneTile: Record<Tone, string> = {
	indigo: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-300',
	emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
	amber: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
	rose: 'border-rose-500/20 bg-rose-500/10 text-rose-400',
	zinc: 'border-white/10 bg-white/5 text-zinc-400'
};
