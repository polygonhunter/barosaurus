import { debounce, Notice, Platform, loadPdfJs, type App, type Plugin, type TFile } from "obsidian";
import type { SearchEngine } from "../core/engine";
import { extractedTextKey, kindForExtension } from "../core/index-types";
import { idleScheduler, OcrQueue } from "../core/ocr-queue";
import { isPathExcluded } from "../core/paths";
import { attachmentDoc } from "../index/content";
import { yielder } from "../index/yielder";
import type { BarosaurusSettings } from "../settings";
import { assetsPresent, ensureAssets } from "./assets";
import { OcrCache } from "./ocr-cache";
// Type-only: tesseract.js must not be evaluated at plugin load — it is
// desktop-only and pulls in a worker. Loaded lazily on the first image job.
import type { OcrService } from "./ocr-service";

/** Hard cap per file — extracted text is a low-weight helper field. */
const MAX_EXTRACTED_CHARS = 20_000;
const MAX_PDF_PAGES = 100;
/**
 * ocr-cache.json holds the text of EVERY recognized file and is rewritten as
 * a whole. Written after a quiet spell, and at least every this many jobs so a
 * long sweep that is interrupted still keeps most of its work.
 */
const CACHE_SAVE_QUIET_MS = 5_000;
const CACHE_SAVE_EVERY_JOBS = 50;
/**
 * How long a cache entry survives without its file before a sweep drops it.
 * Long on purpose: the cache is synced, and an attachment that is merely not
 * downloaded yet must not cost the desktop a second recognition.
 */
const CACHE_MISSING_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * What the settings tab needs from the pipeline: switch extraction on (which
 * may involve the one-time model download) and off again. Kept as its own
 * interface so settings.ts never has to import the pipeline itself.
 */
export interface OcrController {
	/** Fetch the models if needed, then sweep the vault. Returns success. */
	enable(): Promise<boolean>;
	/** Stop extraction, release the worker, flush the cache. */
	disable(): Promise<void>;
}

/**
 * Background text extraction: images through tesseract, PDFs through
 * Obsidian's bundled pdf.js. Runs in idle time, one file at a time, and
 * every result lands in the synced ocr-cache.json — so no file is ever
 * recognized twice, on any device.
 *
 * Wiring (main.ts):
 *   const pipeline = new OcrPipeline(app, engine, () => this.settings,
 *                                    this.manifest.dir ?? "",
 *                                    () => indexer.persistSoon());
 *   await pipeline.init(this);          // onLayoutReady
 *   this.ocr = pipeline;                // lets the settings tab drive it
 *   indexer → pipeline.consider(file, "high")  // per (re)indexed attachment
 *   await pipeline.destroy();           // onunload
 *
 * Nothing here touches the network until the user opts in: `consider` returns
 * immediately while both switches are off, and `enable` is only ever called
 * from the settings toggle.
 */
/** The slice of pdf.js' loading task the extractor uses. */
interface PdfLoadingTask {
	promise: Promise<{
		numPages: number;
		getPage(n: number): Promise<{
			getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
			cleanup?(): void;
		}>;
	}>;
	/** Destroys the loading task AND the document it produced. */
	destroy(): Promise<void>;
}

function isPdf(file: TFile): boolean {
	return file.extension.toLowerCase() === "pdf";
}

/** Could the cache hold an entry for this path — an image or a PDF? */
function isExtractablePath(path: string): boolean {
	const name = path.slice(path.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	if (dot <= 0) return false;
	const extension = name.slice(dot + 1).toLowerCase();
	return extension === "pdf" || kindForExtension(extension) === "image";
}

export class OcrPipeline implements OcrController {
	private readonly queue = new OcrQueue(idleScheduler(window));
	private readonly cache: OcrCache;
	private service: OcrService | null = null;
	private missingAssetsWarned = false;
	/**
	 * Generation of the sweep that is walking the vault right now, or null.
	 * A generation and not a boolean: after disable()+enable() the old sweep
	 * bails out at its next pause, so the new one must be allowed to start —
	 * a boolean made it return at once and left the rest of the vault unswept.
	 */
	private sweepingGeneration: number | null = null;
	/**
	 * False until the cache is loaded. Before that every lookup misses, and
	 * `consider` would queue a recognition for text the cache already holds.
	 */
	private loaded = false;
	/** Set for good on unload; nothing may start or continue after it. */
	private stopped = false;
	/** Bumped by every disable(); in-flight work of an older one bails out. */
	private generation = 0;
	/** Finished jobs since the cache file was last written. */
	private jobsSinceSave = 0;
	/** In flight, so concurrent callers share one load. */
	private loading: Promise<void> | null = null;
	/**
	 * Deletes and renames seen before the cache was loaded (both switches
	 * off), replayed in order once it is. Without this a renamed attachment
	 * lost its entry and had to be recognized again after switching back on.
	 */
	private pendingMoves: Array<{ from: string; to: string | null }> = [];

	constructor(
		private readonly app: App,
		private readonly engine: SearchEngine,
		private readonly getSettings: () => BarosaurusSettings,
		private readonly manifestDir: string,
		private readonly persistSoon: () => void,
	) {
		this.cache = new OcrCache(app, manifestDir);
	}

	/**
	 * Instantiate tesseract on first use only (desktop recognition path).
	 * Returns null once the run that asked has been stopped — a worker created
	 * after disable()/destroy() would never be terminated by anyone.
	 */
	private async getService(generation: number): Promise<OcrService | null> {
		if (this.isStale(generation)) return null;
		if (!this.service) {
			const { OcrService: Service } = await import("./ocr-service");
			if (this.isStale(generation)) return null;
			this.service ??= new Service(this.app, this.manifestDir);
		}
		return this.service;
	}

	/**
	 * True when the work started under `generation` must not continue: the
	 * plugin unloaded, or extraction was switched off (and maybe on again —
	 * which is why a plain boolean is not enough).
	 */
	private isStale(generation: number): boolean {
		return this.stopped || generation !== this.generation;
	}

	async init(plugin: Plugin): Promise<void> {
		plugin.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.moveEntry(file.path, null);
				this.queue.drop(file.path);
			}),
		);
		plugin.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.moveEntry(oldPath, file.path);
				this.queue.drop(oldPath);
			}),
		);
		// Going to the background is the last reliable moment on mobile.
		plugin.registerDomEvent(activeDocument, "visibilitychange", () => {
			if (activeDocument.visibilityState === "hidden") void this.flushCache();
		});
		// With both switches off nothing reads the cache, so it is not parsed
		// at startup at all — enable() loads it on first use.
		const settings = this.getSettings();
		if (settings.ocrEnabled || settings.indexPdfText) await this.ensureLoaded();
	}

	/** Rename (`to` set) or delete (`to` null) a cache entry, now or once loaded. */
	private moveEntry(from: string, to: string | null): void {
		if (!this.loaded) {
			// Only what the cache can hold, and one entry per file however often
			// it moves: with both switches off the cache may never load, and
			// every rename and delete in the vault used to pile up here.
			if (this.stopped || !isExtractablePath(from)) return;
			const chained = this.pendingMoves.find((move) => move.to === from);
			if (chained !== undefined) chained.to = to;
			else this.pendingMoves.push({ from, to });
			return;
		}
		if (to === null) this.cache.remove(from);
		else this.cache.rename(from, to);
		this.saveCacheSoon();
	}

	/** Load the cache once; every later call is free. */
	private async ensureLoaded(): Promise<void> {
		if (this.loaded || this.stopped) return;
		this.loading ??= this.cache.load().then(() => {
			if (this.stopped) return;
			this.loaded = true;
			const moves = this.pendingMoves;
			this.pendingMoves = [];
			for (const { from, to } of moves) this.moveEntry(from, to);
		});
		await this.loading;
	}

	/** Debounced cache write — see CACHE_SAVE_QUIET_MS. */
	private readonly saveCacheSoon = debounce(() => void this.flushCache(), CACHE_SAVE_QUIET_MS, true);

	private async flushCache(): Promise<void> {
		this.saveCacheSoon.cancel();
		this.jobsSinceSave = 0;
		await this.cache.save();
	}

	/** One job stored a result: write soon, or now if many piled up. */
	private resultStored(): void {
		this.jobsSinceSave += 1;
		if (this.jobsSinceSave >= CACHE_SAVE_EVERY_JOBS) void this.flushCache();
		else this.saveCacheSoon();
	}

	// ------------------------------------------------------------ switching on

	/**
	 * Called when the user switches text extraction on. Downloads the
	 * recognition models if OCR is wanted and they are not there yet — the
	 * only network request this plugin ever makes — then sweeps the vault.
	 */
	async enable(): Promise<boolean> {
		if (this.stopped) return false;
		await this.ensureLoaded();
		const settings = this.getSettings();
		const wantsOcr = settings.ocrEnabled && Platform.isDesktop;
		if (wantsOcr && !(await ensureAssets(this.app, this.manifestDir))) return false;
		this.missingAssetsWarned = false;
		this.queue.resume();
		await this.scanVault();
		return true;
	}

	/** Stop extraction and release the worker; re-enabling picks up again. */
	async disable(): Promise<void> {
		this.generation += 1;
		// Pause BEFORE clearing: clear() only empties the lists, and the job
		// that finishes next would otherwise pump whatever arrives meanwhile.
		this.queue.pause();
		this.queue.clear();
		const service = this.service;
		this.service = null;
		await service?.terminate();
		await this.flushCache();
	}

	/** Plugin unload. */
	async destroy(): Promise<void> {
		this.stopped = true;
		await this.disable();
	}

	// ------------------------------------------------------------ eligibility

	/**
	 * Enqueue every eligible attachment. Yields to the UI thread on a time
	 * budget the way the indexer does, so a vault full of images does not freeze
	 * Obsidian while the sweep walks it.
	 */
	async scanVault(priority: "high" | "low" = "low"): Promise<void> {
		if (this.stopped || this.sweepingGeneration === this.generation) return;
		const generation = this.generation;
		this.sweepingGeneration = generation;
		try {
			const excluded = this.getSettings().excludedFolders;
			const maybeYield = yielder();
			for (const file of this.app.vault.getFiles()) {
				if (isPathExcluded(file.path, excluded)) continue;
				this.consider(file, priority);
				if ((await maybeYield()) && this.isStale(generation)) return;
			}
			// Entries for files that no longer exist anywhere in the vault —
			// deleted while Barosaurus was not running, or on another device —
			// are aged out after a grace period. Desktop only: a phone often
			// lacks the attachments on purpose and cannot recognize images
			// anyway. The file list is read AFTER the walk, so files created
			// or renamed while it ran keep their entries. Excluded files are
			// kept too: un-excluding a folder must not cost a second
			// recognition of everything in it.
			if (this.loaded && Platform.isDesktop) {
				const present = new Set(this.app.vault.getFiles().map((file) => file.path));
				if (this.cache.prune(present, Date.now(), CACHE_MISSING_GRACE_MS)) this.saveCacheSoon();
			}
		} finally {
			// A newer sweep may have taken over meanwhile; leave its mark alone.
			if (this.sweepingGeneration === generation) this.sweepingGeneration = null;
		}
	}

	/**
	 * What the cache already knows about this attachment under the current
	 * settings — the indexer writes it straight into the attachment doc, so
	 * re-indexing a file never drops its recognized text. Synchronous on
	 * purpose: it is a map lookup, and the indexer calls it per file.
	 */
	cachedText(file: TFile): string | null {
		const settings = this.getSettings();
		const kind = kindForExtension(file.extension);
		let text: string | null = null;
		if (kind === "image") {
			if (!settings.ocrEnabled) return null;
			text = this.cache.get(
				file.path,
				file.stat.mtime,
				file.stat.size,
				settings.ocrLanguages.join("+"),
			);
		} else if (isPdf(file) && settings.indexPdfText) {
			text = this.cache.get(file.path, file.stat.mtime, file.stat.size, "pdf");
		}
		return text === null ? null : text.slice(0, MAX_EXTRACTED_CHARS);
	}

	/** Called by the indexer for every attachment it (re)indexes. */
	consider(file: TFile, priority: "high" | "low"): void {
		if (!this.loaded || this.stopped) return;
		const settings = this.getSettings();
		const kind = kindForExtension(file.extension);
		if (kind === "image") {
			// Recognition is desktop-only; on a phone the switch is off and
			// disabled, and text recognized on a desktop syncs over anyway.
			if (!settings.ocrEnabled || !Platform.isDesktop) return;
			this.considerImage(file, settings.ocrLanguages.join("+"), priority);
			return;
		}
		if (isPdf(file) && settings.indexPdfText) {
			this.considerPdf(file, priority);
		}
	}

	private considerImage(file: TFile, langs: string, priority: "high" | "low"): void {
		const cached = this.cache.get(file.path, file.stat.mtime, file.stat.size, langs);
		if (cached !== null) {
			this.apply(file, cached);
			return;
		}
		const generation = this.generation;
		this.queue.push(
			file.path,
			async () => {
				if (!(await this.assetsReady())) return;
				const service = await this.getService(generation);
				if (!service) return;
				const url = this.app.vault.getResourcePath(file);
				const text = (await service.recognize(url, langs)).slice(0, MAX_EXTRACTED_CHARS);
				if (this.isStale(generation) || !this.stillExists(file)) return;
				this.cache.set(file.path, {
					mtime: file.stat.mtime,
					size: file.stat.size,
					langs,
					text,
				});
				this.apply(file, text);
				this.resultStored();
			},
			priority,
		);
	}

	private considerPdf(file: TFile, priority: "high" | "low"): void {
		// PDFs are language-independent — keyed with a fixed marker.
		const cached = this.cache.get(file.path, file.stat.mtime, file.stat.size, "pdf");
		if (cached !== null) {
			this.apply(file, cached);
			return;
		}
		const generation = this.generation;
		this.queue.push(
			file.path,
			async () => {
				if (this.isStale(generation)) return;
				// Capped BEFORE caching: only this much is ever indexed, and the
				// cache file is synced and rewritten whole.
				const text = (await this.extractPdfText(file)).slice(0, MAX_EXTRACTED_CHARS);
				if (this.isStale(generation) || !this.stillExists(file)) return;
				this.cache.set(file.path, {
					mtime: file.stat.mtime,
					size: file.stat.size,
					langs: "pdf",
					text,
				});
				this.apply(file, text);
				this.resultStored();
			},
			priority,
		);
	}

	private async extractPdfText(file: TFile): Promise<string> {
		let task: PdfLoadingTask | null = null;
		try {
			const pdfjs = (await loadPdfJs()) as {
				getDocument(options: { data: ArrayBuffer }): PdfLoadingTask;
			};
			const data = await this.app.vault.readBinary(file);
			task = pdfjs.getDocument({ data });
			const doc = await task.promise;
			const parts: string[] = [];
			let length = 0;
			const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
			for (let n = 1; n <= pages && length < MAX_EXTRACTED_CHARS; n++) {
				const page = await doc.getPage(n);
				const content = await page.getTextContent();
				// Page resources (fonts, operator lists) stay alive until
				// cleaned up — a 100-page sweep would otherwise hold them all.
				page.cleanup?.();
				const pageText = content.items
					.map((item) => item.str ?? "")
					.join(" ")
					.trim();
				parts.push(pageText);
				length += pageText.length;
			}
			return parts.join("\n").trim();
		} catch {
			// Scanned or encrypted PDFs simply carry no text layer. Nothing
			// went wrong from the user's point of view, so nothing is said.
			return "";
		} finally {
			// pdf.js keeps every opened document — and its worker-side copy of
			// the whole binary — until destroyed. Without this each PDF in the
			// vault stayed resident for the rest of the session.
			if (task) void task.destroy().catch(() => undefined);
		}
	}

	/**
	 * Push extracted text into the index and schedule persistence — unless
	 * exactly this text is already there. The start-up sweep calls this for
	 * every cached attachment; without the check it re-upserted all of them
	 * and rewrote the whole index snapshot on every launch.
	 */
	private apply(file: TFile, text: string): void {
		const clipped = text.slice(0, MAX_EXTRACTED_CHARS);
		if (this.engine.textKeyOf(file.path) === extractedTextKey(clipped)) return;
		this.engine.upsert(attachmentDoc(file, clipped));
		this.persistSoon();
	}

	/**
	 * Whether a file a job started on is still in the vault. A job runs for
	 * seconds; a file deleted meanwhile must not come back as a phantom doc
	 * and cache entry. A rename is fine — `file.path` already holds the new
	 * path, which is where the result belongs.
	 */
	private stillExists(file: TFile): boolean {
		return this.app.vault.getFileByPath(file.path) === file;
	}

	private async assetsReady(): Promise<boolean> {
		const present = await assetsPresent(this.app, this.manifestDir);
		if (!present && !this.missingAssetsWarned) {
			this.missingAssetsWarned = true;
			new Notice(
				"Barosaurus: reading text in images is switched on, but its models are missing — download them again from the settings.",
				8000,
			);
		}
		return present;
	}
}
