const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Expands `#abc` to `#aabbcc` and drops an alpha channel; returns null if unparseable. */
export function normalizeHex(value: string | null | undefined): string | null {
	if (!value) return null;
	const raw = value.trim();
	if (!HEX_PATTERN.test(raw)) return null;
	let hex = raw.slice(1);
	if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
	return `#${hex.slice(0, 6).toLowerCase()}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const normalized = normalizeHex(hex) ?? '#6366f1';
	return {
		r: parseInt(normalized.slice(1, 3), 16),
		g: parseInt(normalized.slice(3, 5), 16),
		b: parseInt(normalized.slice(5, 7), 16)
	};
}

export function rgbaFromHex(hex: string, alpha: number): string {
	const { r, g, b } = hexToRgb(hex);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Deterministic accent for filaments with no colour set. */
export const DEFAULT_FILAMENT_COLOR = '#6366f1';
