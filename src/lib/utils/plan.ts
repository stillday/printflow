import type { PlanEntryDecoded } from '$lib/types/schema';

/**
 * Calendar maths for the print plan.
 *
 * Plan dates are plain `YYYY-MM-DD` strings standing for a *local* day. Every
 * helper here therefore builds dates at local noon rather than midnight: adding
 * days across a daylight-saving boundary at midnight can land on the previous
 * day, at noon it never can.
 */

/** A day's worth of printing, used to flag an overbooked day. */
export const DAY_CAPACITY_SECONDS = 24 * 3600;

/** `YYYY-MM-DD` for a `Date`, in the local timezone — never UTC. */
export function toPlanDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/** Today as a plan date. */
export function todayPlanDate(): string {
	return toPlanDate(new Date());
}

/** Local noon of a plan date; returns null for anything malformed. */
export function parsePlanDate(iso: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
	if (!match) return null;
	const [, year, month, day] = match;
	const date = new Date(Number(year), Number(month) - 1, Number(day), 12);
	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Formats a plan date for display.
 *
 * `format.ts`'s `formatDate` must not be used for plan dates: it hands
 * `2026-08-13` to `new Date()`, which reads a bare date as UTC midnight and
 * shows the previous day west of Greenwich. This parses to local noon first.
 */
export function formatPlanDate(iso: string, locale: string, options?: Intl.DateTimeFormatOptions) {
	const date = parsePlanDate(iso);
	if (!date) return iso;
	return new Intl.DateTimeFormat(locale, options ?? { dateStyle: 'medium' }).format(date);
}

export function addPlanDays(iso: string, days: number): string {
	const date = parsePlanDate(iso);
	if (!date) return iso;
	date.setDate(date.getDate() + days);
	return toPlanDate(date);
}

/**
 * The Monday of the week `iso` falls in. The app's locales (de, en, nl) all
 * treat Monday as the first day of the week, so it is not configurable.
 */
export function startOfPlanWeek(iso: string): string {
	const date = parsePlanDate(iso);
	if (!date) return iso;
	// getDay(): 0 = Sunday, so Sunday has to go back six days, not forward one.
	const offset = (date.getDay() + 6) % 7;
	date.setDate(date.getDate() - offset);
	return toPlanDate(date);
}

/** `count` consecutive plan dates starting at `startIso`. */
export function planDays(startIso: string, count = 7): string[] {
	return Array.from({ length: count }, (_, index) => addPlanDays(startIso, index));
}

/** Summed print time of the entries that are still open. */
export function dayLoadSeconds(entries: PlanEntryDecoded[]): number {
	return entries
		.filter((entry) => entry.status === 'planned')
		.reduce((total, entry) => total + Math.max(0, entry.estimatedTimeSeconds), 0);
}

/** More planned than fits into the day — worth showing a warning for. */
export function isOverloaded(seconds: number): boolean {
	return seconds > DAY_CAPACITY_SECONDS;
}

/** Groups entries by their day, so a week view can index straight into it. */
export function groupByDate(entries: PlanEntryDecoded[]): Map<string, PlanEntryDecoded[]> {
	const grouped = new Map<string, PlanEntryDecoded[]>();
	for (const entry of entries) {
		const bucket = grouped.get(entry.plannedDate);
		if (bucket) bucket.push(entry);
		else grouped.set(entry.plannedDate, [entry]);
	}
	return grouped;
}

/**
 * Total filament per material for a set of entries — answers "do I have enough
 * PLA for what I planned this week?" without opening every plate.
 */
export function materialTotals(entries: PlanEntryDecoded[]): { material: string; grams: number }[] {
	const totals = new Map<string, number>();
	for (const entry of entries) {
		if (entry.status !== 'planned') continue;
		for (const requirement of entry.filamentRequirements) {
			const material = requirement.materialType.trim().toUpperCase() || 'PLA';
			totals.set(material, (totals.get(material) ?? 0) + Math.max(0, requirement.weightGrams));
		}
	}
	return Array.from(totals, ([material, grams]) => ({ material, grams }))
		.filter((item) => item.grams > 0)
		.sort((a, b) => b.grams - a.grams);
}
