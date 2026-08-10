import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url))
		}
	},
	test: {
		// The .3mf parser uses DOMParser and File, both of which jsdom provides.
		environment: 'jsdom',
		include: ['src/**/*.test.ts']
	}
});
