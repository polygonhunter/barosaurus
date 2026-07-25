import {
	getAllTags,
	prepareFuzzySearch,
	prepareSimpleSearch,
	type App,
	type SearchResult,
	type TFile,
} from "obsidian";
import { kindForExtension } from "../core/index-types";
import { fold } from "../core/normalize";
import { containsPhrase, matchesTag, type ParsedQuery } from "../core/query";
import type { Candidate, OmniItem, ResultKind, TileSpec } from "../core/types";
import { candidatesFromOrdered, type Source, type SourceContext } from "./source";

/**
 * Notes and files, TITLE level: basename, frontmatter aliases and path. The
 * full text of a note is the index layer's job (src/index/), which streams in
 * behind this source — so this one must never touch file CONTENT and never
 * block the first paint.
 *
 * ── Why the matching kit lives in this file ─────────────────────────────────
 * Every source below (headings, tabs, bookmarks, folders, tags, settings)
 * matches a list of strings against the query in exactly the same way, and
 * `src/core/**` may not import obsidian, so `prepareFuzzySearch` cannot live
 * there. This milestone's file ownership allows no new shared module either,
 * so the kit sits with the canonical title-matching corpus and everything else
 * imports it from here. It is pure apart from the injected factory: move it to
 * `src/core/search.ts` (with the factory still injected) the moment that file
 * is allowed to exist.
 */

// ------------------------------------------------------------- matching kit

/** Obsidian's search shape, injected so nothing pure depends on the module. */
export type MatchFactory = (query: string) => (text: string) => SearchResult | null;

/** Quality matcher — for corpora in the hundreds (commands, headings, tags). */
export const fuzzyFactory: MatchFactory = (query) => prepareFuzzySearch(query);

/**
 * Cheap matcher for the thousands-of-files corpus. The typings are explicit:
 * "Performance may be an issue if you are running the search for more than a
 * few thousand times."
 */
export const simpleFactory: MatchFactory = (query) => prepareSimpleSearch(query);

/**
 * The cheap prefilter that runs BEFORE any prepared search: are the query's
 * characters present, in order, in the text? One pass, no allocation, and a
 * strict superset of what fuzzy or simple search can match — so it costs no
 * recall while removing almost the whole corpus from the expensive path.
 */
export function couldMatch(foldedText: string, foldedQuery: string): boolean {
	if (foldedQuery.length === 0) return true;
	let at = 0;
	for (let i = 0; i < foldedText.length && at < foldedQuery.length; i += 1) {
		if (foldedText[i] === foldedQuery[at]) at += 1;
	}
	return at === foldedQuery.length;
}

/** One entry to match: the value to keep, plus every FOLDED term it answers to. */
export interface Scorable<T> {
	value: T;
	terms: readonly string[];
}

/**
 * Prefilter, score, order, cap. Returns the values only — the caller wraps
 * them with `candidatesFromOrdered`, so the [0,1] normalization stays
 * positional and no native score ever leaks into the cross-source comparison.
 *
 * The SearchResult is deliberately NOT passed on to the renderer: it was
 * computed against FOLDED text, whose offsets do not line up with the title
 * the user sees (ß→ss and NFD stripping both change the length). The modal's
 * own fallback highlighter runs against the real title and is correct.
 */
export function orderByMatch<T>(
	entries: readonly Scorable<T>[],
	foldedQuery: string,
	factory: MatchFactory,
	limit: number,
): T[] {
	if (limit <= 0) return [];
	if (foldedQuery.length === 0) return entries.slice(0, limit).map((entry) => entry.value);

	const match = factory(foldedQuery);
	const scored: Array<{ value: T; score: number }> = [];
	for (const entry of entries) {
		let best: number | null = null;
		for (const term of entry.terms) {
			if (!couldMatch(term, foldedQuery)) continue;
			const result = match(term);
			if (result === null) continue;
			if (best === null || result.score > best) best = result.score;
		}
		if (best !== null) scored.push({ value: entry.value, score: best });
	}
	// Array.prototype.sort is stable, so equal scores keep corpus order.
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, limit).map((entry) => entry.value);
}

// ------------------------------------------------------------------- files

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Folded terms per file, invalidated by mtime. Folding is regex work and this
 * runs on every keystroke over the whole vault; TFile identities are stable,
 * so a WeakMap keyed on the file needs no eviction.
 */
const termCache = new WeakMap<TFile, { mtime: number; terms: string[]; aliases: string[] }>();

/**
 * Frontmatter aliases. `aliases:` may be a YAML list OR a single string, and
 * the singular `alias:` key is just as common in the wild — a plain
 * `Array.isArray` read silently loses every note that used the string form.
 */
function aliasesOf(app: App, file: TFile): string[] {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	if (frontmatter === undefined || frontmatter === null) return [];
	const out: string[] = [];
	for (const key of ["aliases", "alias"]) {
		const raw: unknown = frontmatter[key];
		if (typeof raw === "string") {
			for (const part of raw.split(",")) {
				const trimmed = part.trim();
				if (trimmed.length > 0) out.push(trimmed);
			}
		} else if (Array.isArray(raw)) {
			for (const entry of raw) {
				if (typeof entry === "string" && entry.trim().length > 0) out.push(entry.trim());
			}
		}
	}
	return out;
}

function entryFor(app: App, file: TFile): { terms: string[]; aliases: string[] } {
	const cached = termCache.get(file);
	if (cached !== undefined && cached.mtime === file.stat.mtime) return cached;
	const aliases = aliasesOf(app, file);
	const terms = [file.basename, ...aliases, file.path]
		.map(fold)
		.filter((term) => term.length > 0);
	const fresh = { mtime: file.stat.mtime, terms, aliases };
	termCache.set(file, fresh);
	return fresh;
}

function tileFor(kind: ResultKind, path: string, extension: string): TileSpec {
	if (kind === "image") return { kind: "thumbnail", path };
	if (kind === "note") return { kind: "icon", icon: "file-text" };
	if (extension === "canvas") return { kind: "icon", icon: "layout-dashboard" };
	return { kind: "icon", icon: "file" };
}

/** Folder of a path, or undefined at the vault root. */
export function folderOf(path: string): string | undefined {
	const cut = path.lastIndexOf("/");
	return cut <= 0 ? undefined : path.slice(0, cut);
}

export function fileItem(app: App, file: TFile): OmniItem {
	const resultKind = kindForExtension(file.extension);
	const { aliases } = entryFor(app, file);
	const subtitle = folderOf(file.path);
	const item: OmniItem = {
		id: `file:${file.path}`,
		kind: "file",
		source: "file",
		group: "files",
		title: file.basename,
		aliases,
		tile: tileFor(resultKind, file.path, file.extension.toLowerCase()),
		path: file.path,
		resultKind,
		mtime: file.stat.mtime,
	};
	return subtitle === undefined ? item : { ...item, subtitle };
}

function matchesKind(file: TFile, kind: ResultKind | null): boolean {
	// "file" is the generic bucket (the f/d operators), so it excludes nothing.
	if (kind === null || kind === "file") return true;
	if (kind === "link") return false;
	return kindForExtension(file.extension) === kind;
}

function fileTags(app: App, file: TFile): string[] {
	const cache = app.metadataCache.getFileCache(file);
	if (cache === null) return [];
	// getAllTags is per-FILE and public — exactly right here, and exactly wrong
	// for the vault-wide tag list in tags.ts.
	return (getAllTags(cache) ?? []).map((tag) => (tag.startsWith("#") ? tag.slice(1) : tag));
}

/** Everything except the text match: kind, path, recency, tags, phrases, excludes. */
function passesFilters(app: App, file: TFile, query: ParsedQuery, now: number): boolean {
	if (!matchesKind(file, query.kind)) return false;

	if (query.pathPrefix !== null) {
		if (!file.path.toLowerCase().startsWith(query.pathPrefix.toLowerCase())) return false;
	}

	if (query.modifiedWithinDays !== null) {
		if (now - file.stat.mtime > query.modifiedWithinDays * DAY_MS) return false;
	}

	if (query.tags.length > 0) {
		const tags = fileTags(app, file);
		if (tags.length === 0) return false;
		for (const tag of query.tags) if (!matchesTag(tags, tag)) return false;
	}

	if (query.phrases.length > 0 || query.excludes.length > 0) {
		const { aliases } = entryFor(app, file);
		const haystack = [file.basename, ...aliases, file.path].join(" ");
		for (const phrase of query.phrases) if (!containsPhrase(haystack, phrase)) return false;
		for (const excluded of query.excludes) if (containsPhrase(haystack, excluded)) return false;
	}

	return true;
}

export const filesSource: Source = {
	id: "file",

	/**
	 * Vault results only answer the unscoped query: ">" is the command palette,
	 * "@" is the active note's outline, ":42" is a jump. The `l` (link) kind
	 * operator asks for links, which are the ghost source's business, not ours.
	 */
	appliesTo(ctx: SourceContext): boolean {
		return ctx.query.scope === "all" && ctx.query.kind !== "link";
	},

	getCandidates(ctx: SourceContext): Candidate[] {
		const { app, query, limit } = ctx;
		if (limit <= 0) return [];
		const now = ctx.bar.now > 0 ? ctx.bar.now : Date.now();

		// getMarkdownFiles() is the much smaller list — take it whenever the
		// query cannot mean anything but notes.
		const corpus =
			query.kind === "note" ? app.vault.getMarkdownFiles() : app.vault.getFiles();
		const eligible = corpus.filter((file) => passesFilters(app, file, query, now));

		const foldedQuery = fold(query.text);
		if (foldedQuery.length === 0) {
			const noFilters =
				query.kind === null &&
				query.pathPrefix === null &&
				query.modifiedWithinDays === null &&
				query.tags.length === 0;
			const ordered = noFilters ? recentFirst(app, eligible, limit) : byRecency(eligible, limit);
			return candidatesFromOrdered(ordered.map((file) => fileItem(app, file)));
		}

		const entries: Array<Scorable<TFile>> = eligible.map((file) => ({
			value: file,
			terms: entryFor(app, file).terms,
		}));
		const ordered = orderByMatch(entries, foldedQuery, simpleFactory, limit);
		return candidatesFromOrdered(ordered.map((file) => fileItem(app, file)));
	},
};

/** Most recently modified first — the answer when only filters were typed. */
function byRecency(files: readonly TFile[], limit: number): TFile[] {
	return [...files].sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, limit);
}

/**
 * The empty state: the files you just had open, in the order Obsidian
 * remembers them. `workspace.getLastOpenFiles()` is PUBLIC and returns at most
 * ten paths, so the list is topped up with recently modified notes.
 */
function recentFirst(app: App, eligible: readonly TFile[], limit: number): TFile[] {
	const allowed = new Map(eligible.map((file) => [file.path, file]));
	const out: TFile[] = [];
	const seen = new Set<string>();
	for (const path of app.workspace.getLastOpenFiles()) {
		const file = allowed.get(path);
		if (file === undefined || seen.has(path)) continue;
		seen.add(path);
		out.push(file);
		if (out.length >= limit) return out;
	}
	for (const file of byRecency(eligible, limit)) {
		if (seen.has(file.path)) continue;
		seen.add(file.path);
		out.push(file);
		if (out.length >= limit) break;
	}
	return out;
}
