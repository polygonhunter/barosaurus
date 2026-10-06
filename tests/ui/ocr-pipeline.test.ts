// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile, type App, type Plugin } from "obsidian";
import { SearchEngine } from "../../src/core/engine";
import { DEFAULT_WEIGHTS } from "../../src/core/index-types";
import { OcrPipeline } from "../../src/ocr/pipeline";
import { DEFAULT_SETTINGS, type BarosaurusSettings } from "../../src/settings";

/**
 * The extraction pipeline's lifecycle: what happens to work that is still
 * running when the user switches extraction off or the plugin unloads.
 *
 * pdf.js is replaced by a fake whose text arrives only when the test says so,
 * which is the only way to put a job reliably "in flight" at the moment the
 * pipeline is stopped.
 */

interface FakePdf {
	release: () => void;
	destroyed: number;
	pagesCleaned: number;
}

const pdf: FakePdf = { release: () => undefined, destroyed: 0, pagesCleaned: 0 };

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		loadPdfJs: () =>
			Promise.resolve({
				getDocument: () => ({
					promise: Promise.resolve({
						numPages: 1,
						getPage: () =>
							Promise.resolve({
								getTextContent: () =>
									new Promise((resolve) => {
										pdf.release = () => resolve({ items: [{ str: "contract terms" }] });
									}),
								cleanup: () => {
									pdf.pagesCleaned += 1;
								},
							}),
					}),
					destroy: () => {
						pdf.destroyed += 1;
						return Promise.resolve();
					},
				}),
			}),
	};
});

function pdfFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.slice(path.lastIndexOf("/") + 1);
	file.extension = "pdf";
	file.basename = file.name.slice(0, -4);
	file.stat = { ctime: 0, mtime: 1, size: 100 };
	return file;
}

function harness(settings: Partial<BarosaurusSettings>, stored: string | null = null) {
	const writes: string[] = [];
	const reads: string[] = [];
	const files = [pdfFile("docs/contract.pdf")];
	const app = {
		vault: {
			on: () => ({}),
			getFiles: () => files,
			readBinary: () => Promise.resolve(new ArrayBuffer(8)),
			adapter: {
				exists: () => Promise.resolve(stored !== null),
				read: (path: string) => {
					reads.push(path);
					return Promise.resolve(stored ?? "{}");
				},
				write: (_path: string, data: string) => {
					writes.push(data);
					return Promise.resolve();
				},
			},
		},
	} as unknown as App;
	const engine = new SearchEngine(DEFAULT_WEIGHTS);
	const current: BarosaurusSettings = { ...DEFAULT_SETTINGS, ...settings };
	const pipeline = new OcrPipeline(app, engine, () => current, "plugins/barosaurus", () => undefined);
	const plugin = {
		registerEvent: () => undefined,
		registerDomEvent: () => undefined,
	} as unknown as Plugin;
	return { pipeline, engine, writes, reads, file: files[0] as TFile, plugin };
}

/** Let idle-scheduled jobs (setTimeout 200 in jsdom) and microtasks run. */
async function tick(ms = 260): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
	pdf.release = () => undefined;
	pdf.destroyed = 0;
	pdf.pagesCleaned = 0;
});

describe("OcrPipeline lifecycle", () => {
	it("drops the result of a job that was in flight when extraction was switched off", async () => {
		const { pipeline, engine, writes, file, plugin } = harness({ indexPdfText: true });
		await pipeline.init(plugin);
		pipeline.consider(file, "high");
		await tick(); // job is now waiting on getTextContent
		await pipeline.disable();
		pdf.release();
		await tick(20);
		expect(engine.has(file.path)).toBe(false);
		expect(writes).toEqual([]);
	});

	it("does nothing at all after destroy()", async () => {
		const { pipeline, writes, file, plugin } = harness({ indexPdfText: true });
		await pipeline.init(plugin);
		await pipeline.destroy();
		pipeline.consider(file, "high");
		expect(await pipeline.enable()).toBe(false);
		await tick();
		expect(writes).toEqual([]);
	});

	it("indexes a finished PDF job", async () => {
		const { pipeline, engine, file, plugin } = harness({ indexPdfText: true });
		await pipeline.init(plugin);
		pipeline.consider(file, "high");
		await tick();
		pdf.release();
		await tick(20);
		expect(engine.search("contract").map((hit) => hit.id)).toEqual([file.path]);
		expect(pipeline.cachedText(file)).toBe("contract terms");
		// The document and every page are released again.
		expect(pdf.destroyed).toBe(1);
		expect(pdf.pagesCleaned).toBe(1);
		await pipeline.destroy();
	});
});

describe("the extraction cache file", () => {
	const stored = JSON.stringify({
		version: 1,
		entries: {
			"docs/contract.pdf": { mtime: 1, size: 100, langs: "pdf", text: "contract terms" },
			"docs/deleted.pdf": { mtime: 1, size: 100, langs: "pdf", text: "gone for good" },
		},
	});

	it("is not even read while both switches are off", async () => {
		const { pipeline, reads, plugin } = harness({}, stored);
		await pipeline.init(plugin);
		expect(reads).toEqual([]);
		await pipeline.destroy();
	});

	it("loads on enable, serves cached text, and prunes files that are gone", async () => {
		const { pipeline, engine, writes, file, plugin } = harness({}, stored);
		await pipeline.init(plugin);
		expect(pipeline.cachedText(file)).toBeNull();

		const current = { ...DEFAULT_SETTINGS, indexPdfText: true };
		(pipeline as unknown as { getSettings: () => BarosaurusSettings }).getSettings = () => current;
		expect(await pipeline.enable()).toBe(true);

		expect(pipeline.cachedText(file)).toBe("contract terms");
		expect(engine.search("contract").map((hit) => hit.id)).toEqual([file.path]);
		// The harness debounce is synchronous, so the pruned file is written at once.
		const last = JSON.parse(writes[writes.length - 1] ?? "{}") as { entries: object };
		expect(Object.keys(last.entries)).toEqual(["docs/contract.pdf"]);
		await pipeline.destroy();
	});
});
