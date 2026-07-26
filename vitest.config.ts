import { resolve } from "path";
import { defineConfig } from "vitest/config";

/**
 * Two layers, two environments.
 *
 * `tests/*.test.ts` cover `src/core/**`, which never imports obsidian, and keep
 * running under plain node with no shim — that property is an architecture rule,
 * not an accident.
 *
 * `tests/ui/**` run the modal, the keyboard layer and the executor for real,
 * against the fake in `tests/harness/`. Those files opt into jsdom with a
 * `@vitest-environment jsdom` docblock; the alias below is what lets them import
 * the same `src/ui` code the plugin ships.
 */
export default defineConfig({
	resolve: {
		alias: {
			obsidian: resolve(__dirname, "tests/harness/obsidian.ts"),
		},
	},
	test: {
		setupFiles: [resolve(__dirname, "tests/harness/dom.ts")],
	},
});
