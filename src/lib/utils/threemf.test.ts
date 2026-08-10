import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
	ParseError,
	isSupportedFile,
	parseDurationString,
	parsePrintFile,
	suggestPlateName
} from './threemf';

/** Builds an in-memory `.3mf` (a ZIP) from a map of entry path -> content. */
async function makeThreeMf(name: string, entries: Record<string, string>): Promise<File> {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(entries)) zip.file(path, content);
	const blob = await zip.generateAsync({ type: 'blob' });
	return new File([blob], name);
}

function makeGcode(name: string, content: string): File {
	return new File([content], name);
}

const BAMBU_SLICE_INFO = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
  </header>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="prediction" value="4521"/>
    <metadata key="weight" value="35.68"/>
    <metadata key="layer_number" value="120"/>
    <object identify_id="463" name="Leg.stl" skipped="false"/>
    <object identify_id="464" name="Leg.stl" skipped="false"/>
    <object identify_id="465" name="Top_copy_1.stl" skipped="false"/>
    <object identify_id="466" name="Skipped.stl" skipped="true"/>
    <filament id="1" type="PLA" color="#1E1E1E" used_m="11.98" used_g="30.5"/>
    <filament id="2" type="PETG" color="#FF0000" used_m="2.1" used_g="5.18"/>
  </plate>
  <plate>
    <metadata key="index" value="2"/>
    <metadata key="prediction" value="900"/>
    <object identify_id="470" name="Bracket.stl" skipped="false"/>
    <filament id="1" type="PLA" color="#1E1E1E" used_m="3" used_g="8"/>
  </plate>
</config>`;

const MODEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" name="Panel.stl" type="model"/>
    <object id="2" name="Clip.stl" type="model"/>
  </resources>
  <build>
    <item objectid="1"/>
    <item objectid="2"/>
    <item objectid="2"/>
  </build>
</model>`;

describe('isSupportedFile', () => {
	it('accepts slicer formats and rejects everything else', () => {
		expect(isSupportedFile('plate.3mf')).toBe(true);
		expect(isSupportedFile('PLATE.GCODE')).toBe(true);
		expect(isSupportedFile('a.gcode.3mf')).toBe(true);
		expect(isSupportedFile('model.stl')).toBe(false);
		expect(isSupportedFile('notes.txt')).toBe(false);
	});
});

describe('parseDurationString', () => {
	it('understands the formats different slicers emit', () => {
		expect(parseDurationString('4521')).toBe(4521);
		expect(parseDurationString('4521s')).toBe(4521);
		expect(parseDurationString('1h 23m 45s')).toBe(5025);
		expect(parseDurationString('2d 4h')).toBe(187200);
		expect(parseDurationString('01:23:45')).toBe(5025);
	});

	it('returns 0 rather than NaN for junk', () => {
		expect(parseDurationString('')).toBe(0);
		expect(parseDurationString('unknown')).toBe(0);
	});
});

describe('parsePrintFile — Bambu/Orca .3mf', () => {
	it('reads every plate with its time, layers and per-slot filament', async () => {
		const file = await makeThreeMf('Toolwall.3mf', {
			'3D/3dmodel.model': MODEL_XML,
			'Metadata/slice_info.config': BAMBU_SLICE_INFO
		});

		const result = await parsePrintFile(file);

		expect(result.source).toBe('slice_info');
		expect(result.plates).toHaveLength(2);

		const [first, second] = result.plates;
		expect(first.index).toBe(1);
		expect(first.estimatedTimeSeconds).toBe(4521);
		expect(first.layerCount).toBe(120);
		expect(first.filamentRequirements).toEqual([
			{
				slotIndex: 1,
				materialType: 'PLA',
				weightGrams: 30.5,
				colorHex: '#1e1e1e',
				lengthMm: 11980
			},
			{
				slotIndex: 2,
				materialType: 'PETG',
				weightGrams: 5.18,
				colorHex: '#ff0000',
				lengthMm: 2100
			}
		]);

		expect(second.index).toBe(2);
		expect(second.estimatedTimeSeconds).toBe(900);
	});

	it('groups objects by cleaned name and drops skipped ones', async () => {
		const file = await makeThreeMf('Toolwall.3mf', {
			'Metadata/slice_info.config': BAMBU_SLICE_INFO
		});

		const { objects } = (await parsePrintFile(file)).plates[0];

		expect(objects).toEqual([
			{ name: 'Leg', quantity: 2 },
			{ name: 'Top', quantity: 1 }
		]);
	});
});

describe('parsePrintFile — unsliced .3mf project', () => {
	it('still yields object counts and warns that print data is missing', async () => {
		const file = await makeThreeMf('Panels.3mf', { '3D/3dmodel.model': MODEL_XML });

		const result = await parsePrintFile(file);

		expect(result.source).toBe('model');
		expect(result.warnings).toContain('errors.parse.noMetadata');
		expect(result.plates[0].estimatedTimeSeconds).toBe(0);
		expect(result.plates[0].objects).toEqual([
			{ name: 'Clip', quantity: 2 },
			{ name: 'Panel', quantity: 1 }
		]);
	});
});

describe('parsePrintFile — G-code', () => {
	it('reads PrusaSlicer/Orca footer metadata, skipping unused extruders', async () => {
		const file = makeGcode(
			'bracket.gcode',
			[
				'; generated by PrusaSlicer',
				'G1 X0 Y0',
				'; estimated printing time (normal mode) = 1h 23m 45s',
				'; total layer number: 250',
				'; filament used [g] = 12.34, 0, 5.6',
				'; filament used [mm] = 4000.5, 0, 1800.25',
				'; filament_type = PLA;PETG;TPU',
				'; filament_colour = #112233;#000000;#445566'
			].join('\n')
		);

		const { plates, source } = await parsePrintFile(file);

		expect(source).toBe('gcode');
		expect(plates[0].estimatedTimeSeconds).toBe(5025);
		expect(plates[0].layerCount).toBe(250);
		expect(plates[0].filamentRequirements).toEqual([
			{
				slotIndex: 1,
				materialType: 'PLA',
				weightGrams: 12.34,
				colorHex: '#112233',
				lengthMm: 4000.5
			},
			{
				slotIndex: 3,
				materialType: 'TPU',
				weightGrams: 5.6,
				colorHex: '#445566',
				lengthMm: 1800.25
			}
		]);
	});

	it('reads Cura and Bambu header styles', async () => {
		const cura = makeGcode(
			'cura.gcode',
			[';TIME:3600', ';LAYER_COUNT:180', '; filament used [g] = 22.5'].join('\n')
		);
		const curaResult = await parsePrintFile(cura);
		expect(curaResult.plates[0].estimatedTimeSeconds).toBe(3600);
		expect(curaResult.plates[0].layerCount).toBe(180);

		const bambu = makeGcode(
			'bambu.gcode',
			['; total estimated time: 4521s', '; total filament weight [g] : 35.68'].join('\n')
		);
		const bambuResult = await parsePrintFile(bambu);
		expect(bambuResult.plates[0].estimatedTimeSeconds).toBe(4521);
		expect(bambuResult.plates[0].filamentRequirements[0].weightGrams).toBe(35.68);
	});

	it('extracts object names from exclude-object markers', async () => {
		const file = makeGcode(
			'objects.gcode',
			[
				'; object:{"name":"Leg.stl","id":"1"}',
				'; object:{"name":"Leg.stl","id":"2"}',
				'; object:{ broken json',
				'; total estimated time: 60s'
			].join('\n')
		);

		expect((await parsePrintFile(file)).plates[0].objects).toEqual([{ name: 'Leg', quantity: 2 }]);
	});

	it('flags a file with no recognisable metadata instead of failing', async () => {
		const file = makeGcode('plain.gcode', 'G1 X10 Y10\nG1 X20 Y20\n');
		const result = await parsePrintFile(file);

		expect(result.warnings).toContain('errors.parse.noMetadata');
		expect(result.plates[0].estimatedTimeSeconds).toBe(0);
		expect(result.plates[0].filamentRequirements).toEqual([]);
	});
});

describe('parsePrintFile — error handling', () => {
	it('rejects unsupported extensions with a translatable key', async () => {
		await expect(parsePrintFile(new File(['x'], 'model.stl'))).rejects.toMatchObject({
			key: 'errors.parse.unsupported'
		});
	});

	it('reports a corrupt archive rather than throwing a JSZip error', async () => {
		const broken = new File([new Uint8Array([1, 2, 3, 4, 5])], 'broken.3mf');
		await expect(parsePrintFile(broken)).rejects.toBeInstanceOf(ParseError);
		await expect(parsePrintFile(broken)).rejects.toMatchObject({ key: 'errors.parse.corrupt' });
	});

	it('reports a .3mf with nothing usable in it', async () => {
		const empty = await makeThreeMf('empty.3mf', { 'random.txt': 'nothing here' });
		await expect(parsePrintFile(empty)).rejects.toMatchObject({ key: 'errors.parse.noMetadata' });
	});
});

describe('suggestPlateName', () => {
	const plate = {
		index: 2,
		estimatedTimeSeconds: 0,
		layerCount: null,
		filamentRequirements: [],
		objects: []
	};

	it('uses the bare file name for a single-plate file', () => {
		expect(suggestPlateName('Toolwall.gcode.3mf', { ...plate, index: 1 }, 1)).toBe('Toolwall');
	});

	it('disambiguates when one file holds several plates', () => {
		expect(suggestPlateName('Toolwall.3mf', plate, 3)).toBe('Toolwall #2');
	});
});
