import { describe, expect, it } from 'vitest';
import type { PlanEntryDecoded } from '$lib/types/schema';
import {
	DAY_CAPACITY_SECONDS,
	addPlanDays,
	dayLoadSeconds,
	groupByDate,
	isOverloaded,
	materialTotals,
	parsePlanDate,
	planDays,
	startOfPlanWeek,
	toPlanDate
} from './plan';

function entry(overrides: Partial<PlanEntryDecoded> = {}): PlanEntryDecoded {
	return {
		id: 1,
		plateId: 1,
		plannedDate: '2026-08-13',
		position: 0,
		status: 'planned',
		note: null,
		jobId: null,
		plateName: 'Plate',
		projectId: 1,
		projectTitle: 'Project',
		estimatedTimeSeconds: 3600,
		filamentRequirements: [],
		...overrides
	};
}

describe('plan dates', () => {
	it('formats a local date without drifting into the previous day', () => {
		// 00:30 local: a UTC-based conversion would report the 12th east of
		// Greenwich, which is exactly the bug this avoids.
		expect(toPlanDate(new Date(2026, 7, 13, 0, 30))).toBe('2026-08-13');
		expect(toPlanDate(new Date(2026, 7, 13, 23, 30))).toBe('2026-08-13');
		expect(toPlanDate(new Date(2026, 0, 1))).toBe('2026-01-01');
	});

	it('rejects malformed dates instead of inventing one', () => {
		expect(parsePlanDate('nope')).toBeNull();
		expect(parsePlanDate('2026-8-13')).toBeNull();
		expect(parsePlanDate('')).toBeNull();
		expect(parsePlanDate('2026-08-13')).not.toBeNull();
	});

	it('adds days across month, year and DST boundaries', () => {
		expect(addPlanDays('2026-08-13', 1)).toBe('2026-08-14');
		expect(addPlanDays('2026-08-31', 1)).toBe('2026-09-01');
		expect(addPlanDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addPlanDays('2026-01-01', -1)).toBe('2025-12-31');
		// European DST switches: the day must advance by exactly one.
		expect(addPlanDays('2026-03-28', 1)).toBe('2026-03-29');
		expect(addPlanDays('2026-03-29', 1)).toBe('2026-03-30');
		expect(addPlanDays('2026-10-24', 1)).toBe('2026-10-25');
		expect(addPlanDays('2026-10-25', 1)).toBe('2026-10-26');
	});

	it('finds Monday for every weekday, Sunday included', () => {
		// 2026-08-13 is a Thursday.
		expect(startOfPlanWeek('2026-08-13')).toBe('2026-08-10');
		expect(startOfPlanWeek('2026-08-10')).toBe('2026-08-10');
		// Sunday must go back six days, not forward one.
		expect(startOfPlanWeek('2026-08-16')).toBe('2026-08-10');
		expect(startOfPlanWeek('2026-08-17')).toBe('2026-08-17');
	});

	it('builds a seven day week', () => {
		expect(planDays('2026-08-10')).toEqual([
			'2026-08-10',
			'2026-08-11',
			'2026-08-12',
			'2026-08-13',
			'2026-08-14',
			'2026-08-15',
			'2026-08-16'
		]);
	});
});

describe('day load', () => {
	it('counts open entries only', () => {
		const entries = [
			entry({ estimatedTimeSeconds: 3600 }),
			entry({ estimatedTimeSeconds: 1800, status: 'done' }),
			entry({ estimatedTimeSeconds: 900, status: 'skipped' })
		];
		expect(dayLoadSeconds(entries)).toBe(3600);
	});

	it('ignores a negative estimate rather than subtracting it', () => {
		expect(dayLoadSeconds([entry({ estimatedTimeSeconds: -500 })])).toBe(0);
	});

	it('flags a day only above 24 hours', () => {
		expect(isOverloaded(DAY_CAPACITY_SECONDS)).toBe(false);
		expect(isOverloaded(DAY_CAPACITY_SECONDS + 1)).toBe(true);
	});
});

describe('grouping and material totals', () => {
	it('keeps entry order within a day', () => {
		const grouped = groupByDate([
			entry({ id: 1, plannedDate: '2026-08-13', position: 0 }),
			entry({ id: 2, plannedDate: '2026-08-14' }),
			entry({ id: 3, plannedDate: '2026-08-13', position: 1 })
		]);
		expect(grouped.get('2026-08-13')?.map((e) => e.id)).toEqual([1, 3]);
		expect(grouped.get('2026-08-14')?.map((e) => e.id)).toEqual([2]);
	});

	it('sums filament per material, heaviest first, normalising the name', () => {
		const entries = [
			entry({
				filamentRequirements: [
					{ slotIndex: 1, materialType: 'PLA', weightGrams: 30 },
					{ slotIndex: 2, materialType: 'PETG', weightGrams: 10 }
				]
			}),
			entry({
				filamentRequirements: [{ slotIndex: 1, materialType: 'pla', weightGrams: 5 }]
			}),
			// Done entries are already printed — they must not be counted again.
			entry({
				status: 'done',
				filamentRequirements: [{ slotIndex: 1, materialType: 'PLA', weightGrams: 999 }]
			})
		];
		expect(materialTotals(entries)).toEqual([
			{ material: 'PLA', grams: 35 },
			{ material: 'PETG', grams: 10 }
		]);
	});
});
