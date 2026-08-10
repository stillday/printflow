/**
 * Tiny validation helpers. Each returns an i18n key on failure and `null` on
 * success, so form state stays translatable end to end.
 */

export function requiredText(value: string | null | undefined): string | null {
	return value && value.trim().length > 0 ? null : 'errors.required';
}

export function positiveNumber(value: number | null | undefined): string | null {
	if (value === null || value === undefined || Number.isNaN(value)) return 'errors.invalidNumber';
	return value > 0 ? null : 'errors.mustBePositive';
}

export function nonNegativeNumber(value: number | null | undefined): string | null {
	if (value === null || value === undefined || Number.isNaN(value)) return 'errors.invalidNumber';
	return value >= 0 ? null : 'errors.mustNotBeNegative';
}

export function optionalUrl(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	try {
		const url = new URL(trimmed);
		return url.protocol === 'http:' || url.protocol === 'https:' ? null : 'errors.invalidUrl';
	} catch {
		return 'errors.invalidUrl';
	}
}

/** True when every entry of a validation map is `null`. */
export function isValid(errors: Record<string, string | null>): boolean {
	return Object.values(errors).every((error) => error === null);
}

/** `<input type="number">` yields '' for an empty field; treat that as NaN. */
export function toNumber(value: string | number): number {
	if (typeof value === 'number') return value;
	const trimmed = value.trim().replace(',', '.');
	return trimmed === '' ? Number.NaN : Number(trimmed);
}
