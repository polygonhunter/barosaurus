// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Platform, TFile, type App, type Plugin } from "obsidian";
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
			getFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
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
	return { pipeline, engine, writes, reads, file: files[0] as TFile, plugin, files };
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

	it("drops the result of a job whose file was deleted meanwhile", async () => {
		const { pipeline, engine, file, plugin, files } = harness({ indexPdfText: true });
		await pipeline.init(plugin);
		pipeline.consider(file, "high");
		await tick(); // job is now waiting on getTextContent
		files.splice(0, files.length);
		pdf.release();
		await tick(20);
		expect(engine.has(file.path)).toBe(false);
		expect(pipeline.cachedText(file)).toBeNull();
		await pipeline.destroy();
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

	type Written = { entries: Record<string, { missingSince?: number }> };
	const lastWrite = (writes: string[]) => JSON.parse(writes[writes.length - 1] ?? "{}") as Written;
	const DAY = 24 * 60 * 60 * 1000;

	it("loads on enable, serves cached text, and only marks a missing file at first", async () => {
		const { pipeline, engine, writes, file, plugin } = harness({}, stored);
		await pipeline.init(plugin);
		expect(pipeline.cachedText(file)).toBeNull();

		const current = { ...DEFAULT_SETTINGS, indexPdfText: true };
		(pipeline as unknown as { getSettings: () => BarosaurusSettings }).getSettings = () => current;
		expect(await pipeline.enable()).toBe(true);

		expect(pipeline.cachedText(file)).toBe("contract terms");
		expect(engine.search("contract").map((hit) => hit.id)).toEqual([file.path]);
		// The harness debounce is synchronous, so the mark is written at once.
		const last = lastWrite(writes);
		expect(Object.keys(last.entries)).toEqual(["docs/contract.pdf", "docs/deleted.pdf"]);
		expect(last.entries["docs/deleted.pdf"]?.missingSince).toEqual(expect.any(Number));
		expect(last.entries["docs/contract.pdf"]?.missingSince).toBeUndefined();
		await pipeline.destroy();
	});

	it("drops an entry only after its file has been missing for the grace period", async () => {
		const now = vi.spyOn(Date, "now");
		try {
			const start = 1_800_000_000_000;
			now.mockReturnValue(start);
			const { pipeline, writes, plugin } = harness({ indexPdfText: true }, stored);
			await pipeline.init(plugin);
			await pipeline.scanVault();
			now.mockReturnValue(start + 29 * DAY);
			await pipeline.scanVault();
			expect(Object.keys(lastWrite(writes).entries)).toContain("docs/deleted.pdf");
			now.mockReturnValue(start + 31 * DAY);
			await pipeline.scanVault();
			expect(Object.keys(lastWrite(writes).entries)).toEqual(["docs/contract.pdf"]);
			await pipeline.destroy();
		} finally {
			now.mockRestore();
		}
	});

	it("never ages out entries on a phone, which may simply lack the attachments", async () => {
		const platform = Platform as { isDesktop: boolean };
		platform.isDesktop = false;
		try {
			const { pipeline, writes, plugin } = harness({ indexPdfText: true }, stored);
			await pipeline.init(plugin);
			await pipeline.scanVault();
			expect(writes).toEqual([]);
			await pipeline.destroy();
		} finally {
			platform.isDesktop = true;
		}
	});
});
