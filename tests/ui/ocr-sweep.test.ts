// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { TFile, type App, type Plugin } from "obsidian";
import { SearchEngine } from "../../src/core/engine";
import { DEFAULT_WEIGHTS } from "../../src/core/index-types";
import { OcrPipeline } from "../../src/ocr/pipeline";
import { DEFAULT_SETTINGS, type BarosaurusSettings } from "../../src/settings";

/**
 * The vault sweep under concurrency: settings flipped while it runs, files
 * appearing while it runs, and what it does to the synced cache afterwards.
 *
 * The yielder is replaced by one that pauses after EVERY file, as in a vault
 * large enough to exceed the frame budget — that is when the races happen.
 */
vi.mock("../../src/index/yielder", () => ({
	yielder: () => async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
		return true;
	},
}));

function pdfFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path;
	file.extension = "pdf";
	file.basename = path.slice(0, -4);
	file.stat = { ctime: 0, mtime: 1, size: 100 };
	return file;
}

function harness(files: TFile[], stored: string | null = null) {
	const writes: string[] = [];
	const app = {
		vault: {
			on: () => ({}),
			getFiles: () => [...files],
			getFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
			// Never resolves: jobs stay in flight, only the sweep itself is observed.
			readBinary: () => new Promise(() => undefined),
			adapter: {
				exists: () => Promise.resolve(stored !== null),
				read: () => Promise.resolve(stored ?? "{}"),
				write: (_path: string, data: string) => {
					writes.push(data);
					return Promise.resolve();
				},
			},
		},
	} as unknown as App;
	const current: BarosaurusSettings = { ...DEFAULT_SETTINGS, indexPdfText: true };
	const pipeline = new OcrPipeline(app, new SearchEngine(DEFAULT_WEIGHTS), () => current, "x", () => undefined);
	const plugin = { registerEvent: () => undefined, registerDomEvent: () => undefined } as unknown as Plugin;
	return { pipeline, plugin, writes };
}

const turn = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("OCR sweep", () => {
	it("sweeps the whole vault again after disable()+enable() during a running sweep", async () => {
		const files = Array.from({ length: 50 }, (_, i) => pdfFile(`f${i}.pdf`));
		const { pipeline, plugin } = harness(files);
		await pipeline.init(plugin);
		const seen: string[] = [];
		const consider = pipeline.consider.bind(pipeline);
		pipeline.consider = (file, priority) => {
			seen.push(file.path);
			consider(file, priority);
		};
		const first = pipeline.enable();
		for (let i = 0; i < 5; i++) await turn();
		const before = seen.length;
		await pipeline.disable();
		await pipeline.enable();
		await first;
		expect(new Set(seen.slice(before)).size).toBe(files.length);
		await pipeline.destroy();
	});
});
