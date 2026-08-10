import type { JobStatus, ProjectStatus, SpoolStatus, SpoolWithCatalog } from '$lib/types/schema';

export type Tone = 'emerald' | 'amber' | 'rose' | 'indigo' | 'zinc';

/** Below this share of a full spool the UI switches to the amber warning tone. */
export const LOW_STOCK_RATIO = 0.15;

export function spoolTone(status: SpoolStatus, fillRatio: number): Tone {
	if (status === 'archived') return 'zinc';
	if (status === 'empty') return 'rose';
	return fillRatio <= LOW_STOCK_RATIO ? 'amber' : 'emerald';
}

export function projectTone(status: ProjectStatus): Tone {
	switch (status) {
		case 'completed':
			return 'emerald';
		case 'in_progress':
			return 'indigo';
		case 'archived':
			return 'zinc';
		default:
			return 'amber';
	}
}

export function jobTone(status: JobStatus): Tone {
	switch (status) {
		case 'success':
			return 'emerald';
		case 'failed':
			return 'rose';
		default:
			return 'zinc';
	}
}

/** Remaining filament as a share of the catalog's nominal weight. */
export function fillRatio(spool: SpoolWithCatalog): number {
	const nominal = spool.catalog.nominalWeight;
	if (!nominal || nominal <= 0) return 0;
	return Math.min(1, Math.max(0, spool.currentWeightNet / nominal));
}

export function isLowStock(spool: SpoolWithCatalog): boolean {
	return spool.status === 'active' && fillRatio(spool) <= LOW_STOCK_RATIO;
}

/** Human label for a spool: "Bambu Lab · Matte Charcoal (PLA)". */
export function spoolTitle(spool: SpoolWithCatalog): string {
	return `${spool.catalog.brand} · ${spool.catalog.name}`;
}
