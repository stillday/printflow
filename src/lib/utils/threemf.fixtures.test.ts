import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePrintFile } from './threemf';

/**
 * These fixtures are trimmed copies of real Bambu Studio output — the metadata
 * entries only, with meshes, thumbnails and the embedded G-code macros removed.
 * Synthetic fixtures kept missing what these expose: a Bambu project saved
 * without slicing has an *empty* `slice_info.config`, carries no object names
 * in `3dmodel.model` at all, and hides the plate layout in
 * `model_settings.config`.
 */
function loadFixture(name: string): File {
	// Not `import.meta.url` — under jsdom that is an http:// URL, not a file path.
	const path = resolve(process.cwd(), 'src/lib/utils/__fixtures__', name);
	return new File([readFileSync(path)], name);
}

describe('real Bambu Studio project files', () => {
	it('reads object names for an unsliced single-plate project', async () => {
		const result = await parsePrintFile(loadFixture('bambu-project-single-plate.3mf'));

		expect(result.source).toBe('model');
		expect(result.warnings).toContain('errors.parse.noMetadata');
		expect(result.plates).toHaveLength(1);
		// Regression: `3dmodel.model` has no name here, so this used to be "#2".
		expect(result.plates[0].objects).toEqual([{ name: 'Frantic Sango', quantity: 1 }]);
	});

	it('keeps every build plate of an unsliced multi-plate project apart', async () => {
		const result = await parsePrintFile(loadFixture('bambu-project-multi-plate.3mf'));

		expect(result.source).toBe('model');
		// Regression: all four plates used to collapse into a single one.
		expect(result.plates.map((plate) => plate.index)).toEqual([1, 2, 3, 4]);
		expect(result.plates.map((plate) => plate.objects)).toEqual([
			[{ name: 'Storage - PlayTile Holder', quantity: 1 }],
			[{ name: 'Leg Carrier', quantity: 1 }],
			[{ name: 'Storage - Standard Rail Holder - Part A', quantity: 1 }],
			[{ name: 'Storage - Standard Rail Holder - Part B', quantity: 1 }]
		]);
		// Nothing was sliced, so there is no time or filament data to invent.
		for (const plate of result.plates) {
			expect(plate.estimatedTimeSeconds).toBe(0);
			expect(plate.filamentRequirements).toEqual([]);
		}
	});
});

describe('real Bambu Studio G-code', () => {
	it('reads time, layers and filament from a sliced A1 print', async () => {
		const result = await parsePrintFile(loadFixture('bambu-real.gcode'));

		expect(result.source).toBe('gcode');
		expect(result.warnings).toEqual([]);
		expect(result.plates).toHaveLength(1);

		const [plate] = result.plates;
		// "; model printing time: 6h 42m 54s; total estimated time: 6h 49m 17s"
		// — the first pattern must not stop at the semicolon of the earlier field.
		expect(plate.estimatedTimeSeconds).toBe(6 * 3600 + 49 * 60 + 17);
		expect(plate.layerCount).toBe(53);

		// Bambu reports one aggregate weight even for a two-colour print, and
		// separates the per-slot lists with semicolons rather than commas.
		expect(plate.filamentRequirements).toEqual([
			{
				slotIndex: 1,
				materialType: 'PLA',
				weightGrams: 190.32,
				colorHex: '#00ae42',
				lengthMm: undefined
			}
		]);
	});
});
