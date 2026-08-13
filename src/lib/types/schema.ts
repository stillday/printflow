/**
 * Domain types. These mirror the SQLite schema in
 * `src-tauri/migrations/`; the repositories in `$lib/db` do the
 * snake_case <-> camelCase mapping so nothing else has to care about SQL.
 */

export type SpoolStatus = 'active' | 'empty' | 'archived';
export type ProjectStatus = 'planning' | 'in_progress' | 'completed' | 'archived';
export type JobStatus = 'success' | 'failed' | 'cancelled';
export type PlanStatus = 'planned' | 'done' | 'skipped';

export const SPOOL_STATUSES: SpoolStatus[] = ['active', 'empty', 'archived'];
export const PROJECT_STATUSES: ProjectStatus[] = [
	'planning',
	'in_progress',
	'completed',
	'archived'
];

/** Common materials offered as suggestions; the field stays free text. */
export const COMMON_MATERIALS = [
	'PLA',
	'PLA+',
	'PETG',
	'ABS',
	'ASA',
	'TPU',
	'PA',
	'PC',
	'PVA',
	'HIPS'
] as const;

/** Reference densities in g/cm³, used to pre-fill the catalog form. */
export const MATERIAL_DENSITIES: Record<string, number> = {
	PLA: 1.24,
	'PLA+': 1.24,
	PETG: 1.27,
	ABS: 1.04,
	ASA: 1.07,
	TPU: 1.21,
	PA: 1.14,
	PC: 1.2,
	PVA: 1.23,
	HIPS: 1.04
};

export interface FilamentCatalog {
	id?: number;
	brand: string;
	material: string;
	name: string;
	colorHex: string;
	density: number;
	spoolTareWeight: number;
	nominalWeight: number;
	printingTempMin?: number | null;
	printingTempMax?: number | null;
	createdAt?: string;
}

export interface Spool {
	id?: number;
	catalogId: number;
	qrOrBarCode?: string | null;
	currentWeightNet: number;
	cost: number;
	location?: string | null;
	status: SpoolStatus;
	openedAt?: string | null;
	createdAt?: string;
}

/** A spool joined with its catalog entry — what the UI actually renders. */
export interface SpoolWithCatalog extends Spool {
	catalog: FilamentCatalog;
}

export interface Project {
	id?: number;
	title: string;
	description?: string | null;
	sourceUrl?: string | null;
	status: ProjectStatus;
	createdAt: string;
	updatedAt: string;
}

/** Aggregated part counters, computed in SQL for the project list. */
export interface ProjectWithProgress extends Project {
	partCount: number;
	requiredTotal: number;
	printedTotal: number;
	failedTotal: number;
}

export interface Part {
	id?: number;
	projectId: number;
	name: string;
	requiredQuantity: number;
	printedQuantity: number;
	failedQuantity: number;
	sortOrder?: number;
}

/** One entry of `PrintPlate.filamentRequirementsJson`. */
export interface FilamentRequirement {
	slotIndex: number;
	materialType: string;
	weightGrams: number;
	/** Colour reported by the slicer, if any — used for the slot swatch. */
	colorHex?: string;
	lengthMm?: number;
}

/** One entry of `PrintPlate.partsOnPlateJson`. */
export interface PartOnPlate {
	partId: number;
	quantityOnPlate: number;
}

export interface PrintPlate {
	id?: number;
	projectId: number;
	name: string;
	fileName: string;
	estimatedTimeSeconds: number;
	layerCount?: number | null;
	filamentRequirementsJson: string;
	partsOnPlateJson: string;
	createdAt?: string;
}

/** A plate with its JSON columns already decoded. */
export interface PrintPlateDecoded extends PrintPlate {
	filamentRequirements: FilamentRequirement[];
	partsOnPlate: PartOnPlate[];
}

/** One entry of `PrintJob.spoolIdsUsedJson`. */
export interface SpoolAssignment {
	slotIndex: number;
	spoolId: number;
	/** Grams actually deducted, kept for auditability of the stock movement. */
	weightGrams: number;
}

export interface PrintJob {
	id?: number;
	plateId: number;
	spoolIdsUsedJson: string;
	startedAt: string;
	completedAt?: string | null;
	status: JobStatus;
	actualDurationSeconds?: number | null;
	failureReason?: string | null;
}

export interface PrintJobDecoded extends PrintJob {
	spoolsUsed: SpoolAssignment[];
	plateName: string;
}

/**
 * One planned print of one plate on one day.
 *
 * `plannedDate` is a local calendar date (`YYYY-MM-DD`), not a timestamp — a
 * plan is "Tuesday", so it must not shift with the timezone.
 */
export interface PlanEntry {
	id?: number;
	plateId: number;
	plannedDate: string;
	/** Order within the day. */
	position: number;
	status: PlanStatus;
	note?: string | null;
	/** Set once the entry was closed by logging a real print. */
	jobId?: number | null;
	createdAt?: string;
}

/** A plan entry with the plate and project data needed to render a row. */
export interface PlanEntryDecoded extends PlanEntry {
	plateName: string;
	projectId: number;
	projectTitle: string;
	estimatedTimeSeconds: number;
	filamentRequirements: FilamentRequirement[];
}
