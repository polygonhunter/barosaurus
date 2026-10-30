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
	/**
	 * Paths this device removed since the last write. The merge in save()
	 * must not bring them back from the copy on disk.
	 */
	private readonly removed = new Set<string>();
	/** The save in flight; the next one starts after it. */
	private saving: Promise<void> = Promise.resolve();
	private readonly path: string;

	constructor(
		private readonly app: App,
		manifestDir: string,
	) {
		this.path = normalizePath(`${manifestDir}/ocr-cache.json`);
	}

	async load(): Promise<void> {
		try {
			// Merge instead of replace — tolerant of sync-merged files.
			this.entries = { ...(await this.readFile()), ...this.entries };
		} catch {
			// Corrupt cache = cold cache. Never fatal.
		}
	}

	/** The entries in the file as it is on disk now; {} when there is none. */
	private async readFile(): Promise<Record<string, OcrCacheEntry>> {
		if (!(await this.app.vault.adapter.exists(this.path))) return {};
		const raw = JSON.parse(await this.app.vault.adapter.read(this.path)) as Partial<CacheFileShape>;
		return raw.entries ?? {};
	}

	get(path: string, mtime: number, size: number, langs: string): string | null {
		const entry = this.entries[path];
		if (!entry) return null;
		if (entry.mtime !== mtime || entry.size !== size || entry.langs !== langs) return null;
		return entry.text;
	}

	set(path: string, entry: OcrCacheEntry): void {
		this.entries[path] = entry;
		this.removed.delete(path);
		this.dirty = true;
	}

	remove(path: string): void {
		if (path in this.entries) {
			delete this.entries[path];
			this.removed.add(path);
			this.dirty = true;
		}
	}

	rename(oldPath: string, newPath: string): void {
		const entry = this.entries[oldPath];
		if (!entry) return;
		delete this.entries[oldPath];
		this.removed.add(oldPath);
		this.entries[newPath] = entry;
		this.removed.delete(newPath);
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
				this.removed.add(path);
				changed = true;
			}
		}
		if (changed) this.dirty = true;
		return changed;
	}

	/**
	 * Write the cache — merged with the file as it is NOW, not as it was at
	 * load. The file is synced: another desktop may have recognized images
	 * since this one started, and writing the in-memory copy as a whole threw
	 * that work away. Entries this device holds win; entries it removed stay
	 * removed.
	 */
	save(): Promise<void> {
		// One at a time: two overlapping saves would each merge with the file
		// as it was BEFORE the other's write, and bring removed entries back.
		const run = this.saving.then(() => this.saveNow());
		this.saving = run.catch(() => undefined);
		return run;
	}

	private async saveNow(): Promise<void> {
		if (!this.dirty) return;
		this.dirty = false;
		const removed = [...this.removed];
		this.removed.clear();
		try {
			let onDisk: Record<string, OcrCacheEntry> = {};
			try {
				onDisk = await this.readFile();
			} catch {
				// Unreadable on disk: nothing to merge, ours is the better copy.
			}
			for (const [path, entry] of Object.entries(onDisk)) {
				if (path in this.entries || removed.includes(path)) continue;
				this.entries[path] = entry;
			}
			const shape: CacheFileShape = { version: 1, entries: this.entries };
			await this.app.vault.adapter.write(this.path, JSON.stringify(shape));
		} catch {
			// Retry on the next save, still without the removed paths.
			this.dirty = true;
			for (const path of removed) this.removed.add(path);
		}
	}
}
