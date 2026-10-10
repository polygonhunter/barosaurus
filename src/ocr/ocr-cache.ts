import { normalizePath, type App } from "obsidian";

export interface OcrCacheEntry {
	mtime: number;
	size: number;
	/** Language combo the text was recognized with, e.g. "deu+eng". */
	langs: string;
	text: string;
	/**
	 * When a sweep first found no file at this path (ms since epoch). Unset
	 * while the file exists. Optional, so older plugin versions read the file
	 * unchanged and simply ignore the field.
	 */
	missingSince?: number;
}

interface CacheFileShape {
	version: number;
	entries: Record<string, OcrCacheEntry>;
}

/**
 * Extracted-text cache as one JSON file in the plugin dir — deliberately
 * synced, so a second device never re-runs OCR. Merge-tolerant on load
 * (sync conflicts at worst cost one redundant recognition, never data).
 */
export class OcrCache {
	private entries: Record<string, OcrCacheEntry> = {};
	private dirty = false;
	private readonly path: string;

	constructor(
		private readonly app: App,
		manifestDir: string,
	) {
		this.path = normalizePath(`${manifestDir}/ocr-cache.json`);
	}

	async load(): Promise<void> {
		try {
			if (!(await this.app.vault.adapter.exists(this.path))) return;
			const raw = JSON.parse(await this.app.vault.adapter.read(this.path)) as CacheFileShape;
			// Merge instead of replace — tolerant of sync-merged files.
			this.entries = { ...raw.entries, ...this.entries };
		} catch {
			// Corrupt cache = cold cache. Never fatal.
		}
	}

	get(path: string, mtime: number, size: number, langs: string): string | null {
		const entry = this.entries[path];
		if (!entry) return null;
		if (entry.mtime !== mtime || entry.size !== size || entry.langs !== langs) return null;
		return entry.text;
	}

	set(path: string, entry: OcrCacheEntry): void {
		this.entries[path] = entry;
		this.dirty = true;
	}

	remove(path: string): void {
		if (path in this.entries) {
			delete this.entries[path];
			this.dirty = true;
		}
	}

	rename(oldPath: string, newPath: string): void {
		const entry = this.entries[oldPath];
		if (!entry) return;
		delete this.entries[oldPath];
		this.entries[newPath] = entry;
		this.dirty = true;
	}

	/**
	 * Age out entries whose file is gone. An entry whose path is not in
	 * `present` is first only marked as missing; it is dropped once it has
	 * been missing for longer than `graceMs`. A file that shows up again
	 * loses its mark. Returns whether anything changed, so the caller only
	 * writes when it has to.
	 *
	 * Never dropped at first sight: the file is synced, and a device that
	 * merely does not HAVE the attachments yet (first sync still running,
	 * selective sync without images/PDFs) would otherwise empty the cache and
	 * sync that back to the desktop that did the recognizing.
	 */
	prune(present: ReadonlySet<string>, now: number, graceMs: number): boolean {
		let changed = false;
		for (const [path, entry] of Object.entries(this.entries)) {
			if (present.has(path)) {
				if (entry.missingSince !== undefined) {
					delete entry.missingSince;
					changed = true;
				}
			} else if (entry.missingSince === undefined) {
				entry.missingSince = now;
				changed = true;
			} else if (now - entry.missingSince > graceMs) {
				delete this.entries[path];
				changed = true;
			}
		}
		if (changed) this.dirty = true;
		return changed;
	}

	async save(): Promise<void> {
		if (!this.dirty) return;
		this.dirty = false;
		try {
			const shape: CacheFileShape = { version: 1, entries: this.entries };
			await this.app.vault.adapter.write(this.path, JSON.stringify(shape));
		} catch {
			this.dirty = true; // retry on the next save
		}
	}
}
