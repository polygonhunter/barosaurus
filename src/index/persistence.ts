import type { App } from "obsidian";
import { INDEX_SCHEMA_VERSION } from "../core/engine";
import type { FieldWeights } from "../core/index-types";

/** What we keep between sessions: the serialized index + what it covered. */
export interface PersistedIndex {
	schemaVersion: number;
	weightsHash: string;
	indexJson: string;
	/** path → mtime at index time; used to diff against the live vault. */
	files: Record<string, number>;
	/** notePath → ids of its link docs; needed to discard them on change. */
	links: Record<string, string[]>;
}

const STORE = "kv";
const KEY = "index";

/**
 * Vault-scoped localStorage key holding a random id for this vault's cache.
 * `app.appId` would do the same job but is NOT in the public typings — and
 * `app.loadLocalStorage` / `app.saveLocalStorage` (@since 1.8.7, comfortably
 * under our 1.12.4 floor) are already per-vault, so no cast is needed.
 */
const CACHE_ID_KEY = "barosaurus-index-cache-id";

export function weightsHash(weights: FieldWeights): string {
	return JSON.stringify(weights);
}

/** Stable random id for this vault, minted on first use. */
export function vaultCacheId(app: App): string {
	try {
		const stored: unknown = app.loadLocalStorage(CACHE_ID_KEY);
		if (typeof stored === "string" && stored.length > 0) return stored;
		const fresh = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
		app.saveLocalStorage(CACHE_ID_KEY, fresh);
		return fresh;
	} catch (error) {
		console.error("Barosaurus: could not read the index cache id", error);
		// getName() is public and good enough — worst case two same-named
		// vaults share a cache and each rebuilds once on the other's schema.
		return app.vault.getName();
	}
}

function asPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		// DOMException is not an Error subtype — always wrap.
		request.onerror = () =>
			reject(
				new Error(
					`Barosaurus: IndexedDB request failed${request.error ? `: ${request.error.message}` : ""}`,
				),
			);
	});
}

/**
 * Startup cache in IndexedDB (a deliberately tiny hand-rolled key-value
 * wrapper — no storage library): machine-local, rebuildable, and explicitly
 * NOT in the plugin dir, where it would bloat every sync. It is also far too
 * large for localStorage, which is why only the cache *id* lives there.
 *
 * Every read is guarded by the schema version and a hash of the field
 * weights, so a stale or foreign snapshot is discarded rather than misread.
 */
export class IndexPersistence {
	private dbPromise: Promise<IDBDatabase> | null = null;
	private readonly dbName: string;

	constructor(app: App) {
		this.dbName = `barosaurus/${vaultCacheId(app).replace(/[^a-zA-Z0-9]/g, "_")}`;
	}

	private open(): Promise<IDBDatabase> {
		if (!this.dbPromise) {
			// Deliberately `window`, not `activeWindow`: this store outlives any
			// popout, and IndexedDB is shared across windows of one origin.
			const request = window.indexedDB.open(this.dbName, 1);
			request.onupgradeneeded = () => request.result.createObjectStore(STORE);
			this.dbPromise = asPromise(request as IDBRequest<IDBDatabase>);
		}
		return this.dbPromise;
	}

	/** Returns null on miss or schema/weights mismatch (→ full rebuild). */
	async load(weights: FieldWeights): Promise<PersistedIndex | null> {
		try {
			const db = await this.open();
			const data = (await asPromise(db.transaction(STORE).objectStore(STORE).get(KEY))) as
				| PersistedIndex
				| undefined;
			if (!data) return null;
			if (data.schemaVersion !== INDEX_SCHEMA_VERSION) return null;
			if (data.weightsHash !== weightsHash(weights)) return null;
			return data;
		} catch {
			return null; // a corrupt cache is never fatal — rebuild instead
		}
	}

	async save(
		weights: FieldWeights,
		indexJson: string,
		files: Record<string, number>,
		links: Record<string, string[]>,
	): Promise<void> {
		try {
			const payload: PersistedIndex = {
				schemaVersion: INDEX_SCHEMA_VERSION,
				weightsHash: weightsHash(weights),
				indexJson,
				files,
				links,
			};
			const db = await this.open();
			await asPromise(
				db.transaction(STORE, "readwrite").objectStore(STORE).put(payload, KEY),
			);
		} catch {
			// quota / private-mode failures only cost the next startup's speed
		}
	}

	async clear(): Promise<void> {
		try {
			const db = await this.open();
			await asPromise(db.transaction(STORE, "readwrite").objectStore(STORE).delete(KEY));
		} catch {
			// ignore — the schema guard catches whatever survives
		}
	}
}
