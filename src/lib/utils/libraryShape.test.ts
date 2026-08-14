import { describe, expect, it } from 'vitest';
import type { ScannedFile } from '$lib/db/library';
import { analyseLibrary, foldersAreProjects } from './libraryShape';

/** `folder` is what the scanner reports: relative to the scanned root. */
function file(folder: string, fileName = 'plate.3mf'): ScannedFile {
	return {
		path: `/lib/${folder}/${fileName}`.replace('//', '/'),
		fileName,
		folder,
		sizeBytes: 1000,
		modifiedAt: null
	};
}

describe('analyseLibrary', () => {
	it('says nothing about an empty library', () => {
		const analysis = analyseLibrary([]);
		expect(analysis.shape).toBe('empty');
		expect(analysis.fileCount).toBe(0);
	});

	it('calls a heap of files in the root flat', () => {
		const files = ['a.3mf', 'b.3mf', 'c.3mf', 'd.gcode'].map((name) => file('', name));
		const analysis = analyseLibrary(files);
		expect(analysis.shape).toBe('flat');
		expect(analysis.rootFileCount).toBe(4);
		expect(analysis.maxDepth).toBe(0);
	});

	it('still calls it flat when a stray subfolder exists', () => {
		// One tidy corner does not make the library organised.
		const files = [
			...['a.3mf', 'b.3mf', 'c.3mf', 'd.3mf', 'e.3mf', 'f.3mf', 'g.3mf', 'h.3mf'].map((n) =>
				file('', n)
			),
			file('Table', 'leg.3mf')
		];
		expect(analyseLibrary(files).shape).toBe('flat');
	});

	it('recognises one folder per model', () => {
		const files = [
			file('StageTop', 'core.3mf'),
			file('StageTop', 'legs.3mf'),
			file('Verbandskiste', 'box.3mf'),
			file('Ringwurfspiel', 'ring.3mf'),
			file('Makita-Adapter', 'plate.3mf')
		];
		const analysis = analyseLibrary(files);
		expect(analysis.shape).toBe('per-model');
		expect(analysis.folderCount).toBe(4);
		expect(analysis.dominantDepth).toBe(1);
		expect(foldersAreProjects(analysis.shape)).toBe(true);
	});

	it('recognises category folders holding model folders', () => {
		const files = [
			file('Werkstatt/Makita-Adapter', 'a.3mf'),
			file('Werkstatt/Wandhalter', 'b.3mf'),
			file('Spiele/StageTop', 'c.3mf'),
			file('Spiele/Ringwurf', 'd.3mf')
		];
		const analysis = analyseLibrary(files);
		expect(analysis.shape).toBe('categorised');
		expect(analysis.categories).toEqual(['Spiele', 'Werkstatt']);
		expect(analysis.dominantDepth).toBe(2);
	});

	it('does not treat a top-level folder with its own files as a category', () => {
		// Werkstatt holds a file directly, so it is a model folder, not a shelf.
		const files = [
			file('Werkstatt', 'own.3mf'),
			file('Werkstatt/Sub', 'a.3mf'),
			file('Spiele/StageTop', 'c.3mf')
		];
		expect(analyseLibrary(files).categories).toEqual(['Spiele']);
	});

	it('calls deep uneven nesting mixed', () => {
		const files = [
			file('A/B/C/D', 'a.3mf'),
			file('A/B/C/D', 'b.3mf'),
			file('A/B/C/D/E', 'c.3mf')
		];
		const analysis = analyseLibrary(files);
		expect(analysis.shape).toBe('mixed');
		expect(analysis.maxDepth).toBe(5);
		expect(foldersAreProjects(analysis.shape)).toBe(false);
	});

	it('uses a median so one huge folder does not decide the shape', () => {
		const many = Array.from({ length: 40 }, (_, index) => file('Dump', `f${index}.3mf`));
		const files = [...many, file('Modell A', 'a.3mf'), file('Modell B', 'b.3mf')];
		const analysis = analyseLibrary(files);
		// Median across the three folders is 1, so this still reads as per-model
		// even though most *files* live in one dumping ground.
		expect(analysis.medianFilesPerFolder).toBe(1);
		expect(analysis.shape).toBe('per-model');
	});

	it('handles Windows separators, since the scanner reports the platform’s own', () => {
		const files = [file('Werkstatt\\Adapter', 'a.3mf'), file('Spiele\\StageTop', 'b.3mf')];
		const analysis = analyseLibrary(files);
		expect(analysis.dominantDepth).toBe(2);
		expect(analysis.categories).toEqual(['Spiele', 'Werkstatt']);
	});
});
