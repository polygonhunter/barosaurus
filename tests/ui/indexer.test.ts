// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile, type App, type Plugin } from "obsidian";
import { SearchEngine } from "../../src/core/engine";
import { DEFAULT_WEIGHTS } from "../../src/core/index-types";
import { Indexer, type IndexHost } from "../../src/index/indexer";
import { IndexPersistence } from "../../src/index/persistence";

/**
 * The indexer against a fake vault: events in, docs out.
 *
 * What this guards is the seam between the indexer and the OCR cache. An
 * attachment that is modified, renamed or rebuilt is re-indexed from scratch,
 * and before the seam existed that re-index wrote an EMPTY attachment doc —
 * every recognized word silently dropped out of search until the next sweep.
 */

type Handler = (...args: unknown[]) => void;

interface FakeVault {
	app: App;
	plugin: Plugin;
	fire(target: "vault" | "metadataCache", name: string, ...args: unknown[]): void;
	add(path: string, mtime?: number): TFile;
}

function fakeVault(): FakeVault {
	const files = new Map<string, TFile>();
	const handlers = new Map<string, Handler[]>();
	const on = (target: string) => (name: string, cb: Handler) => {
		const key = `${target}:${name}`;
		handlers.set(key, [...(handlers.get(key) ?? []), cb]);
		return { key };
	};
	const app = {
		vault: {
			on: on("vault"),
			getFiles: () => [...files.values()],
			getFileByPath: (path: string) => files.get(path) ?? null,
			getFolderByPath: () => null,
			cachedRead: () => Promise.resolve(""),
			getName: () => "test",
		},
		metadataCache: { on: on("metadataCache"), getFileCache: () => null },
		workspace: { onLayoutReady: (cb: () => void) => cb() },
		loadLocalStorage: () => "cache-id",
		saveLocalStorage: () => undefined,
	} as unknown as App;
	return {
		app,
		plugin: {
			registerEvent: () => undefined,
			registerDomEvent: (el: EventTarget, name: string, cb: EventListener) =>
				el.addEventListener(name, cb),
		} as unknown as Plugin,
		fire(target, name, ...args) {
			for (const cb of handlers.get(`${target}:${name}`) ?? []) cb(...args);
		},
		add(path, mtime = 1) {
			const file = new TFile();
			file.path = path;
			file.name = path.slice(path.lastIndexOf("/") + 1);
			file.extension = file.name.slice(file.name.lastIndexOf(".") + 1);
			file.basename = file.name.slice(0, file.name.lastIndexOf("."));
			file.stat = { ctime: 0, mtime, size: 10 };
			files.set(path, file);
			return file;
		},
	};
}

/** Wait until the indexer's queue has drained. */
async function settle(indexer: Indexer): Promise<void> {
	for (let i = 0; i < 50 && indexer.busy; i++) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Indexer ↔ extraction cache", () => {
	it("keeps recognized text when an attachment is modified", async () => {
		const vault = fakeVault();
		const scan = vault.add("scans/receipt.png");
		const cache = new Map<string, string>([["scans/receipt.png", "quarterly invoice total"]]);
		const indexed: string[] = [];
		const host: IndexHost = {
			getSettings: () => ({ excludedFolders: [] }),
			extractedTextFor: (file) => cache.get(file.path) ?? null,
			onAttachmentIndexed: (file) => indexed.push(file.path),
		};
		const indexer = new Indexer(vault.app, new SearchEngine(DEFAULT_WEIGHTS), DEFAULT_WEIGHTS, host);
		await indexer.start(vault.plugin);
		await settle(indexer);
		expect(indexer.search("invoice").map((hit) => hit.id)).toEqual(["scans/receipt.png"]);

		scan.stat = { ctime: 0, mtime: 2, size: 10 };
		vault.fire("vault", "modify", scan);
		await settle(indexer);

		expect(indexer.search("invoice").map((hit) => hit.id)).toEqual(["scans/receipt.png"]);
		// Once at the initial diff, once for the modify — OCR hears about both.
		expect(indexed).toEqual(["scans/receipt.png", "scans/receipt.png"]);
		indexer.stop();
	});

	it("never asks the cache about notes", async () => {
		const vault = fakeVault();
		vault.add("Notes/plain.md");
		const asked: string[] = [];
		const indexer = new Indexer(vault.app, new SearchEngine(DEFAULT_WEIGHTS), DEFAULT_WEIGHTS, {
			getSettings: () => ({ excludedFolders: [] }),
			extractedTextFor: (file) => {
				asked.push(file.path);
				return null;
			},
		});
		await indexer.start(vault.plugin);
		await settle(indexer);
		expect(asked).toEqual([]);
		expect(indexer.size).toBe(1);
		indexer.stop();
	});
});

describe("Indexer snapshots", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function hide(): void {
		Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
		document.dispatchEvent(new Event("visibilitychange"));
		Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
	}

	it("writes when the app is hidden, and only if something changed", async () => {
		const save = vi.spyOn(IndexPersistence.prototype, "save").mockResolvedValue();
		const vault = fakeVault();
		vault.add("a.md");
		const indexer = new Indexer(vault.app, new SearchEngine(DEFAULT_WEIGHTS), DEFAULT_WEIGHTS, {
			getSettings: () => ({ excludedFolders: [] }),
		});
		await indexer.start(vault.plugin);
		await settle(indexer);
		expect(save).not.toHaveBeenCalled(); // still inside the quiet minute

		hide();
		expect(save).toHaveBeenCalledTimes(1);
		hide();
		expect(save).toHaveBeenCalledTimes(1); // nothing new to write

		indexer.stop();
		expect(save).toHaveBeenCalledTimes(1);
	});

	it("writes pending changes on stop instead of dropping them", async () => {
		const save = vi.spyOn(IndexPersistence.prototype, "save").mockResolvedValue();
		const vault = fakeVault();
		vault.add("a.md");
		const indexer = new Indexer(vault.app, new SearchEngine(DEFAULT_WEIGHTS), DEFAULT_WEIGHTS, {
			getSettings: () => ({ excludedFolders: [] }),
		});
		await indexer.start(vault.plugin);
		await settle(indexer);
		indexer.stop();
		expect(save).toHaveBeenCalledTimes(1);
	});
});
