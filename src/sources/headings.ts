import type { App, TFile } from "obsidian";
import { fold } from "../core/normalize";
import { containsPhrase } from "../core/query";
import type { Candidate, OmniItem } from "../core/types";
import { fuzzyFactory, orderByMatch, type Scorable } from "./files";
import { candidatesFromOrdered, excluderFor, type Source, type SourceContext } from "./source";

/**
 * Headings and block ids — the "@" scope, and a contributor to the unscoped
 * list.
 *
 * Everything comes out of `metadataCache.getFileCache()`, which is a memory
 * lookup: no file is read, so this stays a synchronous source that renders in
 * the first paint. Note CONTENT is the index layer's business.
 *
 * The vault-wide half is bounded on purpose. A vault with 5.000 notes and 15
 * headings each is 75.000 candidates per keystroke; the cheap prefilter makes
 * that survivable, but the file cap is what makes it predictable.
 */

/** Vault-wide scanning starts only once the query is worth it. */
const MIN_VAULT_QUERY = 2;
const VAULT_FILE_CAP = 2000;

interface SymbolRow {
	item: OmniItem;
	/** Folded match term (the heading text or the block id). */
	term: string;
}

/** Per-file rows, invalidated by mtime — folding is the expensive part. */
const rowCache = new Map<string, { mtime: number; rows: SymbolRow[] }>();

function clampLevel(level: number): 1 | 2 | 3 | 4 | 5 | 6 {
	const rounded = Math.round(level);
	if (rounded <= 1) return 1;
	if (rounded >= 6) return 6;
	return rounded as 2 | 3 | 4 | 5;
}

function rowsFor(app: App, file: TFile): SymbolRow[] {
	const cached = rowCache.get(file.path);
	if (cached !== undefined && cached.mtime === file.stat.mtime) return cached.rows;

	const cache = app.metadataCache.getFileCache(file);
	const rows: SymbolRow[] = [];

	for (const heading of cache?.headings ?? []) {
		const text = heading.heading;
		if (typeof text !== "string" || text.length === 0) continue;
		const line = heading.position?.start?.line ?? 0;
		rows.push({
			term: fold(text),
			item: {
				id: `heading:${file.path}:${line}`,
				kind: "heading",
				source: "heading",
				group: "structure",
				title: text,
				aliases: [],
				subtitle: file.basename,
				tile: { kind: "heading", level: clampLevel(heading.level) },
				path: file.path,
				level: heading.level,
				line,
			},
		});
	}

	// Blocks are keyed by their ^id; the id IS the searchable text, since the
	// block's content only exists on disk and this source never reads files.
	for (const [id, block] of Object.entries(cache?.blocks ?? {})) {
		if (id.length === 0) continue;
		const line = block?.position?.start?.line ?? 0;
		rows.push({
			term: fold(id),
			item: {
				id: `block:${file.path}:${id}`,
				kind: "block",
				source: "block",
				group: "structure",
				title: `^${id}`,
				aliases: [id],
				subtitle: file.basename,
				tile: { kind: "icon", icon: "link" },
				path: file.path,
				blockId: id,
				line,
			},
		});
	}

	rowCache.set(file.path, { mtime: file.stat.mtime, rows });
	return rows;
}

/**
 * Which files contribute. Under "@" that is the active note and nothing else —
 * the sigil promises "this note's outline", and a vault-wide answer would make
 * it useless for jumping around a long document.
 */
function filesToScan(ctx: SourceContext): TFile[] {
	const { app, query, bar } = ctx;
	const active = bar.activeFile === null ? null : app.vault.getFileByPath(bar.activeFile);
	// "@" is about the note you are IN. Refusing to show the outline of a note
	// the user has open, because it happens to sit in an excluded folder, would
	// be the setting overruling an explicit request.
	if (query.scope === "symbol") return active === null ? [] : [active];

	const isExcluded = excluderFor(ctx);
	const out: TFile[] = [];
	const seen = new Set<string>();
	const take = (file: TFile | null): void => {
		if (file === null || seen.has(file.path) || file.extension !== "md") return;
		if (isExcluded(file.path)) return;
		seen.add(file.path);
		out.push(file);
	};

	take(active);
	for (const path of app.workspace.getLastOpenFiles()) take(app.vault.getFileByPath(path));

	if (fold(query.text).length >= MIN_VAULT_QUERY) {
		for (const file of app.vault.getMarkdownFiles()) {
			take(file);
			if (out.length >= VAULT_FILE_CAP) break;
		}
	}
	return out;
}

export const headingsSource: Source = {
	id: "heading",

	/**
	 * "@" is ours alone; ">" and ":42" are not. Under "all" a structure hit is
	 * only useful next to its note, so the vault operators (kind letter, path,
	 * recency, #tag) hand the query to the files source instead.
	 */
	appliesTo(ctx: SourceContext): boolean {
		if (ctx.query.scope === "symbol") return ctx.bar.activeFile !== null;
		if (ctx.query.scope !== "all") return false;
		return (
			ctx.query.kind === null &&
			ctx.query.pathPrefix === null &&
			ctx.query.modifiedWithinDays === null &&
			ctx.query.tags.length === 0 &&
			fold(ctx.query.text).length > 0
		);
	},

	getCandidates(ctx: SourceContext): Candidate[] {
		const { app, query, limit } = ctx;
		if (limit <= 0) return [];

		const entries: Array<Scorable<OmniItem>> = [];
		for (const file of filesToScan(ctx)) {
			for (const row of rowsFor(app, file)) {
				if (query.phrases.some((phrase) => !containsPhrase(row.item.title, phrase))) continue;
				if (query.excludes.some((word) => containsPhrase(row.item.title, word))) continue;
				entries.push({ value: row.item, terms: [row.term] });
			}
		}

		// Under "@" with no text the outline itself is the answer, in document
		// order — which is what orderByMatch returns for an empty query.
		return candidatesFromOrdered(orderByMatch(entries, fold(query.text), fuzzyFactory, limit));
	},
};
