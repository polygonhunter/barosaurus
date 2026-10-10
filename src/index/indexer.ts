import { TFile, TFolder, type App, type Plugin } from "obsidian";
import type { SearchOptions } from "minisearch";
import type { SearchEngine } from "../core/engine";
import type { FieldWeights, SearchHit } from "../core/index-types";
import { isPathExcluded } from "../core/paths";
import { extractDocs } from "./content";
import { yielder } from "./yielder";
import { IndexPersistence } from "./persistence";

/**
 * A snapshot is the WHOLE index serialized — megabytes for a large vault —
 * so it is written after a quiet minute, not after every burst of typing…
 */
const SAVE_QUIET_MS = 60_000;
/** …but never later than this after the first unsaved change. */
const SAVE_MAX_WAIT_MS = 5 * 60_000;

/** The slice of plugin settings the index cares about. */
export interface IndexSettings {
	/** Vault-relative folder paths excluded from the index. */
	excludedFolders: string[];
}

/**
 * Structural host. The indexer reads settings through this rather than
 * importing the plugin class, which would close an import cycle
 * (main → indexer → main). Any object with a matching `getSettings` fits.
 */
export interface IndexHost {
	getSettings(): IndexSettings;
	/**
	 * Text already extracted from an attachment (OCR / PDF text layer), read
	 * synchronously from the extraction cache; null when there is none or
	 * extraction is switched off. Declared as a property, not a method, so
	 * pulling it off the host is not an unbound-method read.
	 */
	extractedTextFor?: (file: TFile) => string | null;
	/** Called after an attachment was (re)indexed — lets OCR pick it up. */
	onAttachmentIndexed?: (file: TFile) => void;
}

/**
 * Owns the index lifecycle: cached-startup load, mtime diff against the
 * vault, chunked build, and incremental updates from vault/metadataCache
 * events. The engine stays pure; this class is the only thing that talks to
 * the vault.
 */
export class Indexer {
	private readonly persistence: IndexPersistence;
	/** path → mtime of everything currently in the index. */
	private readonly indexedFiles = new Map<string, number>();
	/** notePath → ids of its link docs (discarded when the note changes). */
	private readonly linkDocs = new Map<string, string[]>();
	private readonly queue: string[] = [];
	private readonly queued = new Set<string>();
	private processing = false;
	private stopped = false;
	/** The snapshot write in flight, so stop() can close the db after it. */
	private pendingSave: Promise<void> | null = null;
	/** Changes since the last snapshot; 0 means there is nothing to write. */
	private dirty = 0;
	/** When the oldest unsaved change happened (for the max wait). */
	private dirtySince = 0;
	private saveTimer: number | null = null;

	constructor(
		private readonly app: App,
		private readonly engine: SearchEngine,
		private readonly weights: FieldWeights,
		private readonly host: IndexHost,
	) {
		this.persistence = new IndexPersistence(app);
	}

	/** True while the build/diff still has queued work — drives "indexing…". */
	get busy(): boolean {
		return this.queue.length > 0 || this.processing;
	}

	/** How many documents are currently searchable. */
	get size(): number {
		return this.engine.size;
	}

	// ------------------------------------------------------------ query surface

	/**
	 * The surface the sources layer calls. Delegating rather than handing out
	 * the engine keeps "who owns the index" answerable: sources read, the
	 * indexer writes.
	 */
	search(query: string, options?: SearchOptions): SearchHit[] {
		return this.engine.search(query, options);
	}

	/** Same, with `-word` exclusions applied inside MiniSearch (AND_NOT). */
	searchWithExcludes(
		query: string,
		excludes: readonly string[],
		options?: SearchOptions,
	): SearchHit[] {
		return this.engine.searchWithExcludes(query, excludes, options);
	}

	// ------------------------------------------------------------ lifecycle

	/**
	 * Load the cache, then diff and wire events once the layout is ready.
	 *
	 * The onLayoutReady wrapper is not decoration: `vault.on('create')` fires
	 * for EVERY existing file while the vault loads, so registering earlier
	 * floods the queue with the whole vault on startup. onLayoutReady runs its
	 * callback immediately when the layout is already up, so calling start()
	 * late is fine too.
	 */
	async start(plugin: Plugin): Promise<void> {
		const persisted = await this.persistence.load(this.weights);
		if (persisted && !this.stopped) {
			try {
				await this.engine.loadAsync(persisted.indexJson);
				for (const [path, mtime] of Object.entries(persisted.files)) {
					this.indexedFiles.set(path, mtime);
				}
				for (const [path, ids] of Object.entries(persisted.links)) {
					this.linkDocs.set(path, ids);
				}
			} catch {
				// A snapshot that survived the schema guard but will not load is
				// still just a cache — throw it away and rebuild.
				this.engine.clear();
				this.indexedFiles.clear();
				this.linkDocs.clear();
			}
		}
		// The app going to the background (phone switched away, window
		// hidden) is the last reliable moment on mobile — write then.
		plugin.registerDomEvent(activeDocument, "visibilitychange", () => {
			if (activeDocument.visibilityState === "hidden") this.flushSave();
		});
		this.app.workspace.onLayoutReady(() => {
			if (this.stopped) return;
			this.registerEvents(plugin);
			this.diffVault();
		});
	}

	/**
	 * Plugin unload. A snapshot that is still waiting on its debounce is
	 * written NOW rather than cancelled — cancelling it threw away every change
	 * of the last quiet period, and the next start had to re-index them.
	 */
	stop(): void {
		this.flushSave();
		this.stopped = true;
		const pending = this.pendingSave ?? Promise.resolve();
		void pending.finally(() => this.persistence.close());
	}

	/** Wipe everything and re-index from scratch (settings escape hatch). */
	async rebuild(): Promise<void> {
		this.queue.length = 0;
		this.queued.clear();
		this.engine.clear();
		this.indexedFiles.clear();
		this.linkDocs.clear();
		this.clearSaveTimer();
		this.dirty = 0;
		await this.persistence.clear();
		this.diffVault();
	}

	/**
	 * Re-apply the exclusion settings. A folder added to the exclude list must
	 * drop out of the index immediately, not at the next restart — diffVault
	 * handles both directions.
	 */
	onSettingsChanged(): void {
		this.diffVault();
	}

	/** Let collaborators schedule an index snapshot. */
	persistSoon(): void {
		this.markDirty();
	}

	// ------------------------------------------------------------ events

	private registerEvents(plugin: Plugin): void {
		// Markdown: 'changed' fires once Obsidian has re-parsed the cache — the
		// right moment to pick up headings/aliases/tags along with the body.
		plugin.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				this.enqueue(file.path);
			}),
		);
		// Past tense here, unlike Vault's 'delete'. metadataCache has exactly
		// four events: changed, deleted, resolve, resolved.
		plugin.registerEvent(
			this.app.metadataCache.on("deleted", (file) => {
				this.forget(file.path);
			}),
		);
		// Attachments have no metadata cache; watch the vault directly.
		plugin.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile && file.extension !== "md") this.enqueue(file.path);
			}),
		);
		plugin.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.extension !== "md") this.enqueue(file.path);
			}),
		);
		plugin.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFolder) this.forgetTree(file.path);
				else this.forget(file.path);
			}),
		);
		// THE load-bearing one. A rename does NOT fire metadataCache 'changed'
		// ("not called when a file is renamed for performance reasons — you
		// must hook the vault rename event for those"), and our doc ids ARE
		// vault paths. Without this handler every rename leaves a phantom doc
		// under the old path and the new name is never searchable.
		plugin.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFolder) {
					this.renameTree(oldPath, file.path);
				} else {
					this.forget(oldPath);
					if (file instanceof TFile) this.enqueue(file.path);
				}
			}),
		);
	}

	// ------------------------------------------------------------ bookkeeping

	/** Queue every new/stale file; drop deleted and newly excluded ones. */
	private diffVault(): void {
		const seen = new Set<string>();
		for (const file of this.app.vault.getFiles()) {
			// Excluded files are deliberately left out of `seen`, so anything
			// indexed before the exclusion was added gets forgotten below.
			if (this.isExcluded(file.path)) continue;
			seen.add(file.path);
			if (this.indexedFiles.get(file.path) !== file.stat.mtime) {
				this.enqueue(file.path);
			}
		}
		for (const path of [...this.indexedFiles.keys()]) {
			if (!seen.has(path)) this.forget(path);
		}
	}

	private isExcluded(path: string): boolean {
		return isPathExcluded(path, this.host.getSettings().excludedFolders);
	}

	private enqueue(path: string): void {
		if (this.stopped || this.isExcluded(path) || this.queued.has(path)) return;
		this.queued.add(path);
		this.queue.push(path);
		void this.processQueue();
	}

	private forget(path: string): void {
		this.engine.remove(path);
		for (const id of this.linkDocs.get(path) ?? []) this.engine.remove(id);
		this.linkDocs.delete(path);
		const known = this.indexedFiles.delete(path);
		this.queued.delete(path);
		if (known) this.markDirty();
	}

	/** Drop every indexed file under a folder. */
	private forgetTree(folderPath: string): void {
		const prefix = `${folderPath}/`;
		for (const path of [...this.indexedFiles.keys()]) {
			if (path === folderPath || path.startsWith(prefix)) this.forget(path);
		}
	}

	/**
	 * A folder rename moves every descendant's path — and therefore every
	 * descendant's doc id. Obsidian is not required to emit a per-file rename
	 * for those, so re-key the whole subtree ourselves.
	 */
	private renameTree(oldPath: string, newPath: string): void {
		this.forgetTree(oldPath);
		// getFolderByPath is better typed than getAbstractFileByPath +
		// instanceof, and confirms the destination actually exists.
		if (!this.app.vault.getFolderByPath(newPath)) return;
		const prefix = `${newPath}/`;
		for (const file of this.app.vault.getFiles()) {
			if (file.path.startsWith(prefix)) this.enqueue(file.path);
		}
	}

	// ------------------------------------------------------------ processing

	private async processQueue(): Promise<void> {
		if (this.processing) return;
		this.processing = true;
		try {
			const maybeYield = yielder();
			while (this.queue.length > 0 && !this.stopped) {
				const path = this.queue.shift();
				if (path === undefined) break;
				this.queued.delete(path);
				await this.indexPath(path);
				await maybeYield();
			}
		} finally {
			this.processing = false;
		}
	}

	private async indexPath(path: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		try {
			const isNote = file.extension === "md";
			const extracted = isNote ? null : (this.host.extractedTextFor?.(file) ?? null);
			const docs = await extractDocs(this.app, file, extracted ?? "");
			// The file may have been deleted or renamed while it was read. Its
			// forget() has already run, so writing now would leave a phantom
			// doc under a path that no longer exists (a rename re-queues the
			// new path on its own).
			if (this.stopped || this.app.vault.getFileByPath(path) !== file || file.path !== path) return;
			const newLinkIds = new Set(
				docs.filter((doc) => doc.kind === "link").map((doc) => doc.id),
			);
			// Drop link docs of URLs that no longer exist in the note.
			for (const id of this.linkDocs.get(file.path) ?? []) {
				if (!newLinkIds.has(id)) this.engine.remove(id);
			}
			for (const doc of docs) {
				this.engine.upsert(doc);
			}
			this.linkDocs.set(file.path, [...newLinkIds]);
			this.indexedFiles.set(file.path, file.stat.mtime);
			this.markDirty();
			if (!isNote) this.host.onAttachmentIndexed?.(file);
		} catch (error) {
			console.error(`Barosaurus: failed to index ${path}`, error);
		}
	}

	// ------------------------------------------------------------ snapshot

	/**
	 * Note one change and (re)arm the save timer: a quiet minute, capped so a
	 * vault that never goes quiet is still saved every five minutes.
	 */
	private markDirty(): void {
		if (this.stopped) return;
		const now = Date.now();
		if (this.dirty === 0) this.dirtySince = now;
		this.dirty += 1;
		this.clearSaveTimer();
		const wait = Math.max(0, Math.min(SAVE_QUIET_MS, this.dirtySince + SAVE_MAX_WAIT_MS - now));
		// `window`, not `activeWindow`: a timer has no DOM to belong to.
		this.saveTimer = window.setTimeout(() => this.flushSave(), wait);
	}

	private clearSaveTimer(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = null;
	}

	/** Write the snapshot now — if, and only if, something changed. */
	private flushSave(): void {
		this.clearSaveTimer();
		if (this.dirty === 0 || this.stopped) return;
		this.dirty = 0;
		this.pendingSave = this.persistence.save(
			this.weights,
			this.engine.toJSON(),
			Object.fromEntries(this.indexedFiles),
			Object.fromEntries(this.linkDocs),
		);
	}
}
