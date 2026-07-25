import { debounce, TFile, TFolder, type App, type Plugin } from "obsidian";
import type { SearchOptions } from "minisearch";
import type { SearchEngine } from "../core/engine";
import type { FieldWeights, SearchHit } from "../core/index-types";
import { isPathExcluded } from "../core/paths";
import { extractDocs } from "./content";
import { IndexPersistence } from "./persistence";

/** Files (re)indexed per chunk before yielding back to the UI thread. */
const CHUNK_SIZE = 20;

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
		if (persisted) {
			try {
				this.engine.load(persisted.indexJson);
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
		this.app.workspace.onLayoutReady(() => {
			if (this.stopped) return;
			this.registerEvents(plugin);
			this.diffVault();
		});
	}

	stop(): void {
		this.stopped = true;
		this.saveSoon.cancel();
	}

	/** Wipe everything and re-index from scratch (settings escape hatch). */
	async rebuild(): Promise<void> {
		this.queue.length = 0;
		this.queued.clear();
		this.engine.clear();
		this.indexedFiles.clear();
		this.linkDocs.clear();
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
		this.saveSoon();
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
		this.indexedFiles.delete(path);
		this.queued.delete(path);
		this.saveSoon();
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
			let sinceYield = 0;
			while (this.queue.length > 0 && !this.stopped) {
				const path = this.queue.shift();
				if (path === undefined) break;
				this.queued.delete(path);
				await this.indexPath(path);
				if (++sinceYield >= CHUNK_SIZE) {
					sinceYield = 0;
					// setTimeout(0), NOT requestIdleCallback: the latter does not
					// exist on every mobile platform we ship to. `window` and not
					// `activeWindow` on purpose — this loop must survive a popout
					// being closed mid-build.
					await new Promise((resolve) => window.setTimeout(resolve, 0));
				}
			}
		} finally {
			this.processing = false;
		}
		if (!this.stopped) this.saveSoon();
	}

	private async indexPath(path: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		try {
			const docs = await extractDocs(this.app, file);
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
		} catch (error) {
			console.error(`Barosaurus: failed to index ${path}`, error);
		}
	}

	/** Persisting is cheap but not free — debounce behind quiet periods. */
	private readonly saveSoon = debounce(
		() => {
			void this.persistence.save(
				this.weights,
				this.engine.toJSON(),
				Object.fromEntries(this.indexedFiles),
				Object.fromEntries(this.linkDocs),
			);
		},
		10_000,
		true,
	);
}
