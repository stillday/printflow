import { describe, expect, it } from 'vitest';
import type { ScannedFile } from '$lib/db/library';
import { filterFiles, groupByFolder, splitFolder, suggestProjectName } from './library';

function file(overrides: Partial<ScannedFile> = {}): ScannedFile {
	return {
		path: '/models/a.3mf',
		fileName: 'a.3mf',
		folder: '',
		sizeBytes: 1000,
		modifiedAt: null,
		...overrides
	};
}

describe('splitFolder', () => {
	it('handles both separators, because the scanner uses the platform’s own', () => {
		expect(splitFolder('Table/Legs')).toEqual(['Table', 'Legs']);
		expect(splitFolder('Table\\Legs')).toEqual(['Table', 'Legs']);
		expect(splitFolder('')).toEqual([]);
		// Trailing or doubled separators must not produce empty segments.
		expect(splitFolder('Table//Legs/')).toEqual(['Table', 'Legs']);
	});
});

describe('groupByFolder', () => {
	it('groups files, sums their size and counts the imported ones', () => {
		const files = [
			file({ path: '/m/top.3mf', fileName: 'top.3mf', folder: '', sizeBytes: 500 }),
			file({ path: '/m/T/a.3mf', fileName: 'a.3mf', folder: 'T', sizeBytes: 1500 }),
			file({ path: '/m/T/b.3mf', fileName: 'b.3mf', folder: 'T', sizeBytes: 2500 })
		];
		const groups = groupByFolder(files, new Set(['/m/T/b.3mf']));

		expect(groups.map((g) => g.folder)).toEqual(['', 'T']);
		expect(groups[0]).toMatchObject({ segments: [], totalBytes: 500, importedCount: 0 });
		expect(groups[1]).toMatchObject({ segments: ['T'], totalBytes: 4000, importedCount: 1 });
		expect(groups[1].files.map((f) => f.fileName)).toEqual(['a.3mf', 'b.3mf']);
	});

	it('ignores a negative size rather than subtracting it', () => {
		const groups = groupByFolder([file({ sizeBytes: -100 })], new Set());
		expect(groups[0].totalBytes).toBe(0);
	});
});

describe('filterFiles', () => {
	const files = [
		file({ fileName: 'leg.3mf', folder: 'Table/Legs' }),
		file({ fileName: 'panel_hex.gcode', folder: 'Table' }),
		file({ fileName: 'box.3mf', folder: 'Kiste' })
	];

	it('matches file name and folder', () => {
		expect(filterFiles(files, 'leg').map((f) => f.fileName)).toEqual(['leg.3mf']);
		expect(filterFiles(files, 'kiste').map((f) => f.fileName)).toEqual(['box.3mf']);
	});

	it('requires every word, in any order', () => {
		expect(filterFiles(files, 'table leg').map((f) => f.fileName)).toEqual(['leg.3mf']);
		expect(filterFiles(files, 'leg table').map((f) => f.fileName)).toEqual(['leg.3mf']);
		expect(filterFiles(files, 'table missing')).toEqual([]);
	});

	it('returns everything for an empty term', () => {
		expect(filterFiles(files, '   ')).toHaveLength(3);
	});
});

describe('suggestProjectName', () => {
	it('uses the innermost folder — in a library that is the model', () => {
		expect(suggestProjectName(file({ folder: 'Table/Legs' }))).toBe('Legs');
		expect(suggestProjectName(file({ folder: 'Verbandsmaterial Kiste' }))).toBe(
			'Verbandsmaterial Kiste'
		);
	});

	it('falls back to the file name in the scanned root', () => {
		expect(suggestProjectName(file({ folder: '', fileName: 'Holder.3mf' }))).toBe('Holder');
		expect(suggestProjectName(file({ folder: '', fileName: 'plate.gcode.3mf' }))).toBe('plate');
	});
});
