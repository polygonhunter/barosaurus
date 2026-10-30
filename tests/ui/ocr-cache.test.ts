// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { OcrCache, type OcrCacheEntry } from "../../src/ocr/ocr-cache";

/**
 * ocr-cache.json is synced. Two devices write it; neither may throw away what
 * the other recognized just because it loaded the file before that happened.
 */

function entry(text: string): OcrCacheEntry {
	return { mtime: 1, size: 1, langs: "eng", text };
}

function disk(initial: Record<string, OcrCacheEntry> | null) {
	const state = {
		content: initial === null ? null : JSON.stringify({ version: 1, entries: initial }),
	};
	const app = {
		vault: {
			adapter: {
				exists: () => Promise.resolve(state.content !== null),
				read: () => Promise.resolve(state.content ?? "{}"),
				write: (_path: string, data: string) => {
					state.content = data;
					return Promise.resolve();
				},
			},
		},
	} as unknown as App;
	const entries = (): Record<string, OcrCacheEntry> =>
		(JSON.parse(state.content ?? "{}") as { entries: Record<string, OcrCacheEntry> }).entries;
	/** Another device's write, arriving through sync. */
	const synced = (next: Record<string, OcrCacheEntry>): void => {
		state.content = JSON.stringify({ version: 1, entries: next });
	};
	return { app, entries, synced };
}

describe("OcrCache.save merges with the file on disk", () => {
	it("keeps what another device wrote after this one loaded", async () => {
		const { app, entries, synced } = disk({ "a.png": entry("a") });
		const cache = new OcrCache(app, "plugins/barosaurus");
		await cache.load();

		synced({ "a.png": entry("a"), "b.png": entry("b from the desktop") });
		cache.set("c.png", entry("c"));
		await cache.save();

		expect(Object.keys(entries()).sort()).toEqual(["a.png", "b.png", "c.png"]);
	});

	it("does not bring back what this device removed or renamed away", async () => {
		const { app, entries } = disk({ "a.png": entry("a"), "old.png": entry("o") });
		const cache = new OcrCache(app, "plugins/barosaurus");
		await cache.load();

		cache.remove("a.png");
		cache.rename("old.png", "new.png");
		await cache.save();

		expect(Object.keys(entries()).sort()).toEqual(["new.png"]);
	});

	it("lets this device's own entry win over the one on disk", async () => {
		const { app, entries, synced } = disk({});
		const cache = new OcrCache(app, "plugins/barosaurus");
		await cache.load();

		synced({ "a.png": entry("stale") });
		cache.set("a.png", entry("fresh"));
		await cache.save();

		expect(entries()["a.png"]?.text).toBe("fresh");
	});
});
