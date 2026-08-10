import JSZip from 'jszip';
import type { FilamentRequirement } from '$lib/types/schema';
import { normalizeHex } from './color';

/** Guard against loading a multi-gigabyte file into memory. */
export const MAX_FILE_BYTES = 400 * 1024 * 1024;

/** Head/tail slice size when scanning a plain .gcode file for its metadata. */
const GCODE_SCAN_BYTES = 512 * 1024;

/** An object instance the slicer placed on a plate. */
export interface ParsedObject {
	name: string;
	quantity: number;
}

export interface ParsedPlate {
	/** 1-based plate index as reported by the slicer. */
	index: number;
	estimatedTimeSeconds: number;
	layerCount: number | null;
	filamentRequirements: FilamentRequirement[];
	objects: ParsedObject[];
}

export type ParseSource = 'slice_info' | 'gcode' | 'model';

export interface ParseResult {
	fileName: string;
	source: ParseSource;
	plates: ParsedPlate[];
	/** i18n keys for anything the user should sanity-check. */
	warnings: string[];
}

/** Carries an i18n key (plus optional interpolation values) instead of prose. */
export class ParseError extends Error {
	constructor(
		readonly key: string,
		readonly values: Record<string, string | number> = {}
	) {
		super(key);
		this.name = 'ParseError';
	}
}

export function isSupportedFile(fileName: string): boolean {
	const lower = fileName.toLowerCase();
	return lower.endsWith('.3mf') || lower.endsWith('.gcode') || lower.endsWith('.gco');
}

/**
 * Reads print metadata out of a slicer file.
 *
 * Handles, in order of preference:
 *  1. `.3mf` with `Metadata/slice_info.config` (Bambu Studio / OrcaSlicer) —
 *     exact per-plate time, weight and per-slot filament.
 *  2. `.3mf` containing sliced G-code (`.gcode.3mf`) — parsed from its header.
 *  3. `.3mf` without slicing results (e.g. a PrusaSlicer project) — object
 *     names only, so the user still gets a plate to fill in.
 *  4. Plain `.gcode` from PrusaSlicer, OrcaSlicer, Bambu Studio or Cura.
 *
 * Anything unreadable raises a `ParseError` carrying an i18n key; the caller
 * never sees an exception it cannot show to the user.
 */
export async function parsePrintFile(file: File): Promise<ParseResult> {
	if (!isSupportedFile(file.name)) {
		throw new ParseError('errors.parse.unsupported');
	}
	if (file.size > MAX_FILE_BYTES) {
		throw new ParseError('errors.parse.tooLarge', {
			max: Math.round(MAX_FILE_BYTES / (1024 * 1024))
		});
	}

	if (file.name.toLowerCase().endsWith('.3mf')) {
		return parseThreeMf(file);
	}
	return parseGcodeFile(file);
}

async function parseThreeMf(file: File): Promise<ParseResult> {
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(await file.arrayBuffer());
	} catch {
		throw new ParseError('errors.parse.corrupt');
	}

	const warnings: string[] = [];

	// 1. Bambu Studio / OrcaSlicer slice results.
	const sliceInfo = findEntry(zip, (path) => path.toLowerCase().endsWith('slice_info.config'));
	if (sliceInfo) {
		try {
			const plates = parseSliceInfo(await sliceInfo.async('string'));
			if (plates.length > 0) {
				return { fileName: file.name, source: 'slice_info', plates, warnings };
			}
		} catch {
			warnings.push('plates.parseWarning');
		}
	}

	// 2. Embedded G-code (".gcode.3mf" exports).
	const gcodeEntries = Object.values(zip.files).filter(
		(entry) => !entry.dir && /\.gcode$/i.test(entry.name)
	);
	if (gcodeEntries.length > 0) {
		const plates: ParsedPlate[] = [];
		for (const [index, entry] of gcodeEntries.entries()) {
			try {
				const text = await entry.async('string');
				const plateIndex = plateNumberFromPath(entry.name) ?? index + 1;
				plates.push(parseGcodeText(text, plateIndex));
			} catch {
				warnings.push('plates.parseWarning');
			}
		}
		if (plates.length > 0) {
			return { fileName: file.name, source: 'gcode', plates, warnings };
		}
	}

	// 3. Unsliced project file — object names are still useful for the BOM.
	const model = findEntry(zip, (path) => path.toLowerCase().endsWith('3dmodel.model'));
	if (model) {
		const objects = parseModelObjects(await model.async('string'));
		warnings.push('errors.parse.noMetadata');
		return {
			fileName: file.name,
			source: 'model',
			plates: [
				{
					index: 1,
					estimatedTimeSeconds: 0,
					layerCount: null,
					filamentRequirements: [],
					objects
				}
			],
			warnings
		};
	}

	throw new ParseError('errors.parse.noMetadata');
}

function findEntry(zip: JSZip, predicate: (path: string) => boolean): JSZip.JSZipObject | null {
	for (const entry of Object.values(zip.files)) {
		if (!entry.dir && predicate(entry.name)) return entry;
	}
	return null;
}

/* -------------------------------------------------------------------------- */
/* Bambu / Orca slice_info.config                                             */
/* -------------------------------------------------------------------------- */

/**
 * `slice_info.config` is a small XML document with one `<plate>` per build
 * plate. Rather than pulling in an XML library we use `DOMParser`, which every
 * WebView ships, and fall back to nothing if the document is malformed.
 */
function parseSliceInfo(xml: string): ParsedPlate[] {
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	if (doc.querySelector('parsererror')) return [];

	const plates: ParsedPlate[] = [];
	doc.querySelectorAll('plate').forEach((plateNode, position) => {
		const metadata = new Map<string, string>();
		plateNode.querySelectorAll(':scope > metadata').forEach((node) => {
			const key = node.getAttribute('key');
			const value = node.getAttribute('value');
			if (key && value !== null) metadata.set(key, value);
		});

		const index = toInt(metadata.get('index')) ?? position + 1;

		const filamentRequirements: FilamentRequirement[] = [];
		plateNode.querySelectorAll(':scope > filament').forEach((node, order) => {
			const weight = toFloat(node.getAttribute('used_g')) ?? 0;
			const length = toFloat(node.getAttribute('used_m'));
			filamentRequirements.push({
				slotIndex: toInt(node.getAttribute('id')) ?? order + 1,
				materialType: node.getAttribute('type')?.trim() || 'PLA',
				weightGrams: round2(weight),
				colorHex: normalizeHex(node.getAttribute('color')) ?? undefined,
				lengthMm: length !== null ? round2(length * 1000) : undefined
			});
		});

		// Some exports report only an aggregate weight — keep it as one slot
		// rather than dropping the information entirely.
		if (filamentRequirements.length === 0) {
			const totalWeight = toFloat(metadata.get('weight'));
			if (totalWeight && totalWeight > 0) {
				filamentRequirements.push({
					slotIndex: 1,
					materialType: 'PLA',
					weightGrams: round2(totalWeight)
				});
			}
		}

		const objects = countObjects(
			Array.from(plateNode.querySelectorAll(':scope > object'))
				.filter((node) => node.getAttribute('skipped') !== 'true')
				.map((node) => cleanObjectName(node.getAttribute('name') ?? ''))
		);

		plates.push({
			index,
			estimatedTimeSeconds: toInt(metadata.get('prediction')) ?? 0,
			layerCount: toInt(metadata.get('layer_number')),
			filamentRequirements,
			objects
		});
	});

	return plates;
}

/** Object names from `3D/3dmodel.model`, counting build items per object. */
function parseModelObjects(xml: string): ParsedObject[] {
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	if (doc.querySelector('parsererror')) return [];

	const names = new Map<string, string>();
	doc.querySelectorAll('resources > object').forEach((node) => {
		const id = node.getAttribute('id');
		if (!id) return;
		const name =
			node.getAttribute('name') ??
			node.querySelector('metadata[name="name"]')?.textContent ??
			`#${id}`;
		names.set(id, cleanObjectName(name));
	});

	const instances: string[] = [];
	doc.querySelectorAll('build > item').forEach((node) => {
		const id = node.getAttribute('objectid');
		if (id && names.has(id)) instances.push(names.get(id)!);
	});

	return countObjects(instances.length > 0 ? instances : Array.from(names.values()));
}

/* -------------------------------------------------------------------------- */
/* G-code                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Slicers write their summary either at the very top (Cura, Bambu) or in a
 * config block at the very bottom (PrusaSlicer, OrcaSlicer), so only the head
 * and tail of the file are read — a 200 MB G-code file costs us 1 MB.
 */
async function parseGcodeFile(file: File): Promise<ParseResult> {
	const head = await file.slice(0, GCODE_SCAN_BYTES).text();
	const tail =
		file.size > GCODE_SCAN_BYTES
			? await file.slice(Math.max(0, file.size - GCODE_SCAN_BYTES)).text()
			: '';

	const plate = parseGcodeText(`${head}\n${tail}`, 1);

	const warnings =
		plate.estimatedTimeSeconds === 0 && plate.filamentRequirements.length === 0
			? ['errors.parse.noMetadata']
			: [];

	return { fileName: file.name, source: 'gcode', plates: [plate], warnings };
}

function parseGcodeText(text: string, index: number): ParsedPlate {
	return {
		index,
		estimatedTimeSeconds: extractTime(text),
		layerCount: extractLayerCount(text),
		filamentRequirements: extractFilament(text),
		objects: extractGcodeObjects(text)
	};
}

function extractTime(text: string): number {
	// Bambu / Orca: "; total estimated time: 4521s" (or a "1h 2m 3s" string).
	const patterns = [
		/;\s*total estimated time\s*[:=]\s*([^\r\n;]+)/i,
		/;\s*estimated printing time \(normal mode\)\s*[:=]\s*([^\r\n;]+)/i,
		/;\s*estimated printing time\s*[:=]\s*([^\r\n;]+)/i,
		/;\s*model printing time\s*[:=]\s*([^\r\n;]+)/i,
		/;TIME:\s*(\d+)/i
	];
	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match) {
			const seconds = parseDurationString(match[1]);
			if (seconds > 0) return seconds;
		}
	}
	return 0;
}

/** Understands `4521`, `4521s`, `1h 23m 45s`, `2d 4h 1m` and `01:23:45`. */
export function parseDurationString(raw: string): number {
	const value = raw.trim();
	if (!value) return 0;

	if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value));

	const clock = value.match(/^(\d+):(\d{2}):(\d{2})$/);
	if (clock) {
		return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
	}

	const units: Record<string, number> = { d: 86400, h: 3600, m: 60, s: 1 };
	let total = 0;
	let matched = false;
	for (const match of value.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/gi)) {
		total += Number(match[1]) * units[match[2].toLowerCase()];
		matched = true;
	}
	return matched ? Math.round(total) : 0;
}

function extractLayerCount(text: string): number | null {
	const patterns = [
		/;\s*total layer number\s*[:=]\s*(\d+)/i,
		/;LAYER_COUNT:\s*(\d+)/i,
		/;\s*total_layer_count\s*[:=]\s*(\d+)/i
	];
	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match) return Number(match[1]);
	}
	return null;
}

function extractFilament(text: string): FilamentRequirement[] {
	const grams = extractNumberList(text, [
		/;\s*filament used \[g\]\s*[:=]\s*([^\r\n]+)/i,
		/;\s*filament weight \[g\]\s*[:=]\s*([^\r\n]+)/i
	]);
	const millimetres = extractNumberList(text, [/;\s*filament used \[mm\]\s*[:=]\s*([^\r\n]+)/i]);
	const types = extractStringList(text, [
		/;\s*filament_type\s*[:=]\s*([^\r\n]+)/i,
		/;\s*filament type\s*[:=]\s*([^\r\n]+)/i
	]);
	const colors = extractStringList(text, [
		/;\s*filament_colour\s*[:=]\s*([^\r\n]+)/i,
		/;\s*filament_color\s*[:=]\s*([^\r\n]+)/i,
		/;\s*extruder_colour\s*[:=]\s*([^\r\n]+)/i
	]);

	// Bambu writes a single aggregate weight rather than a per-extruder list.
	if (grams.length === 0) {
		const total = text.match(/;\s*total filament weight \[g\]\s*[:=]\s*([\d.]+)/i);
		if (total) grams.push(Number(total[1]));
	}

	const slotCount = Math.max(grams.length, millimetres.length);
	if (slotCount === 0) return [];

	const requirements: FilamentRequirement[] = [];
	for (let i = 0; i < slotCount; i++) {
		const weight = grams[i] ?? 0;
		const length = millimetres[i];
		// Skip unused extruder slots so a 4-slot printer profile does not
		// produce three empty rows.
		if (weight <= 0 && (length ?? 0) <= 0) continue;
		requirements.push({
			slotIndex: i + 1,
			materialType: types[i]?.trim() || types[0]?.trim() || 'PLA',
			weightGrams: round2(weight),
			colorHex: normalizeHex(colors[i]) ?? undefined,
			lengthMm: length !== undefined ? round2(length) : undefined
		});
	}
	return requirements;
}

function extractNumberList(text: string, patterns: RegExp[]): number[] {
	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (!match) continue;
		const values = match[1]
			.split(/[,;]/)
			.map((part) => Number(part.trim()))
			.filter((value) => Number.isFinite(value));
		if (values.length > 0) return values;
	}
	return [];
}

function extractStringList(text: string, patterns: RegExp[]): string[] {
	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (!match) continue;
		const values = match[1]
			.split(/[,;]/)
			.map((part) => part.trim().replace(/^"|"$/g, ''))
			.filter(Boolean);
		if (values.length > 0) return values;
	}
	return [];
}

/** `; object:{"name":"Leg","id":"..."}` and `EXCLUDE_OBJECT_DEFINE NAME=Leg`. */
function extractGcodeObjects(text: string): ParsedObject[] {
	const names: string[] = [];

	for (const match of text.matchAll(/^;\s*object:\s*(\{.*\})\s*$/gim)) {
		try {
			const parsed = JSON.parse(match[1]);
			if (typeof parsed?.name === 'string') names.push(cleanObjectName(parsed.name));
		} catch {
			// A malformed object line is not worth failing the whole import for.
		}
	}

	if (names.length === 0) {
		for (const match of text.matchAll(/EXCLUDE_OBJECT_DEFINE\s+NAME=([^\s]+)/gi)) {
			names.push(cleanObjectName(match[1]));
		}
	}

	return countObjects(names);
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

function countObjects(names: string[]): ParsedObject[] {
	const counts = new Map<string, number>();
	for (const name of names) {
		if (!name) continue;
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return Array.from(counts, ([name, quantity]) => ({ name, quantity })).sort((a, b) =>
		a.name.localeCompare(b.name)
	);
}

/** Slicers append the source file extension and copy suffixes to object names. */
function cleanObjectName(raw: string): string {
	return raw
		.trim()
		.replace(/\.(stl|3mf|obj|step|stp)$/i, '')
		.replace(/_copy_?\d+$/i, '')
		.replace(/\s*\(\d+\)$/, '')
		.trim();
}

function plateNumberFromPath(path: string): number | null {
	const match = path.match(/plate[_-]?(\d+)/i);
	return match ? Number(match[1]) : null;
}

/**
 * Default name for an imported plate. Plate files are language-neutral, so we
 * use the source file's base name and only disambiguate when a single file
 * produced several plates.
 */
export function suggestPlateName(fileName: string, plate: ParsedPlate, total: number): string {
	const base = fileName.replace(/\.(gcode\.3mf|3mf|gcode|gco)$/i, '').trim() || fileName;
	return total > 1 ? `${base} #${plate.index}` : base;
}

function toInt(value: string | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

function toFloat(value: string | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}
