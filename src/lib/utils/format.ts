import { get } from 'svelte/store';
import { locale } from 'svelte-i18n';
import { DEFAULT_LOCALE } from '$lib/i18n';

function currentLocale(): string {
	return get(locale) ?? DEFAULT_LOCALE;
}

export function formatNumber(value: number, fractionDigits = 0): string {
	if (!Number.isFinite(value)) return '–';
	return new Intl.NumberFormat(currentLocale(), {
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits
	}).format(value);
}

export function formatGrams(grams: number): string {
	return `${formatNumber(grams, grams % 1 === 0 ? 0 : 1)} g`;
}

/**
 * Compact duration: `2 d 4 h`, `4 h 32 min`, `18 min`.
 * Units come from the locale files so the whole string stays translatable.
 */
export function formatDuration(
	seconds: number,
	labels: { day: string; hour: string; minute: string }
): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return `0 ${labels.minute}`;
	const total = Math.round(seconds);
	const days = Math.floor(total / 86400);
	const hours = Math.floor((total % 86400) / 3600);
	const minutes = Math.floor((total % 3600) / 60);

	if (days > 0) return `${days} ${labels.day} ${hours} ${labels.hour}`;
	if (hours > 0) return `${hours} ${labels.hour} ${minutes} ${labels.minute}`;
	return `${Math.max(1, minutes)} ${labels.minute}`;
}

/** Fractional hours, for the "planned print time" tile. */
export function formatHours(seconds: number): string {
	return formatNumber(seconds / 3600, seconds / 3600 >= 100 ? 0 : 1);
}

export function formatDate(iso: string | null | undefined): string {
	if (!iso) return '–';
	const date = parseTimestamp(iso);
	if (!date) return '–';
	return new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium' }).format(date);
}

export function formatDateTime(iso: string | null | undefined): string {
	if (!iso) return '–';
	const date = parseTimestamp(iso);
	if (!date) return '–';
	return new Intl.DateTimeFormat(currentLocale(), {
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(date);
}

/**
 * Rows written by the app carry a full ISO string, but SQLite column defaults
 * produce `YYYY-MM-DD HH:MM:SS` in UTC — normalise both.
 */
function parseTimestamp(iso: string): Date | null {
	const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(iso)
		? iso.replace(' ', 'T') + 'Z'
		: iso;
	const date = new Date(normalized);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** File sizes for the library listing: `812 kB`, `2,4 MB`, `1,1 GB`. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return '–';
	if (bytes < 1000) return `${formatNumber(bytes)} B`;
	const units = ['kB', 'MB', 'GB', 'TB'];
	let value = bytes / 1000;
	let unit = 0;
	while (value >= 1000 && unit < units.length - 1) {
		value /= 1000;
		unit += 1;
	}
	return `${formatNumber(value, value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatPercent(ratio: number): string {
	if (!Number.isFinite(ratio)) return '0 %';
	return `${formatNumber(Math.round(ratio * 100))} %`;
}

export function formatCurrency(value: number): string {
	return new Intl.NumberFormat(currentLocale(), {
		style: 'currency',
		currency: 'EUR',
		maximumFractionDigits: 2
	}).format(value);
}

export function clampRatio(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

/** `HH:MM` in the user's locale for the ISO date input's sibling label. */
export function toDateInputValue(iso: string | null | undefined): string {
	const date = iso ? parseTimestamp(iso) : new Date();
	if (!date) return '';
	const offset = date.getTimezoneOffset() * 60000;
	return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function fromDateInputValue(value: string): string | null {
	if (!value) return null;
	const date = new Date(`${value}T12:00:00`);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
