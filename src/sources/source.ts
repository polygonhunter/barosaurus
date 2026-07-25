import type { App } from "obsidian";
import type { UserSnippet } from "../core/blocks";
import type { SearchHit } from "../core/index-types";
import { pathExcluder } from "../core/paths";
import type { ParsedQuery } from "../core/query";
import type { BarContext, Candidate, OmniItem } from "../core/types";

/**
 * A result source.
 *
 * The contract that makes a mixed list possible: a source decides for itself
 * what counts as a match (recall) AND how good each of its own hits is
 * relative to its other hits (normalization). It never expresses an opinion
 * about how it compares to other sources — that is the ranker's job, and it
 * does it on tiers, not on native scores.
 *
 * The reason is concrete. MiniSearch returns positive BM25, obsidian's
 * prepareFuzzySearch returns negative numbers, and an open-tab list has no
 * score at all. A source that leaked its raw score into a shared comparator
 * would sink or float its entire category regardless of match quality.
 */

/**
 * The query surface of the full-text index, narrowed to what a source may do
 * with it: read.
 *
 * Deliberately NOT the `Indexer` class. `Indexer` satisfies this structurally
 * (`busy` and `size` are getters, the extra `options` parameter of its two
 * search methods is optional), so nothing has to import it — which keeps the
 * full-text source obsidian-free and testable against a five-line fake, and
 * keeps "who owns the index" answerable: sources read, the indexer writes.
 */
export interface FullTextIndex {
	/** True while the build/diff still has queued work. */
	readonly busy: boolean;
	/** How many documents are searchable right now. 0 = nothing to ask. */
	readonly size: number;
	search(query: string): readonly SearchHit[];
	/** With `-word` exclusions applied inside MiniSearch (AND_NOT). */
	searchWithExcludes(query: string, excludes: readonly string[]): readonly SearchHit[];
}

/**
 * The slice of user settings the sources read.
 *
 * Narrow on purpose: a source that could see the whole settings object would
 * grow opinions about hotkeys and OCR. `BarosaurusSettings` satisfies this
 * structurally, so the plugin passes itself and nothing has to be copied.
 */
export interface SourceSettings {
	/** Vault-relative folders skipped EVERYWHERE, not just in the index. */
	readonly excludedFolders: readonly string[];
	/** Ask each command whether it can run and drop the ones that cannot. */
	readonly hideUnavailableCommands: boolean;
	/** Command ids the user hid from the bar (they still work elsewhere). */
	readonly hiddenCommands: readonly string[];
	/** Search inside note contents, not only titles. */
	readonly fullTextSearch: boolean;
	/** The user's own insert blocks, offered next to the built-in ones. */
	readonly snippets?: readonly UserSnippet[];
}

/**
 * What a source assumes when the host passed no settings — i.e. exactly
 * today's behaviour, so an un-wired host degrades rather than changes: nothing
 * excluded, unavailable commands hidden, nothing hidden by hand.
 *
 * Mirrors DEFAULT_SETTINGS in src/settings.ts; there is no import because
 * settings.ts pulls in the whole obsidian settings tab.
 */
export const DEFAULT_SOURCE_SETTINGS: SourceSettings = {
	excludedFolders: [],
	hideUnavailableCommands: true,
	hiddenCommands: [],
	fullTextSearch: true,
	snippets: [],
};

export interface SourceContext {
	app: App;
	/** The editing situation: selection, active file, view type, now. */
	bar: BarContext;
	/** Parsed input, including the sigil scope that may exclude this source. */
	query: ParsedQuery;
	/** Upper bound on returned candidates. Sources must respect it. */
	limit: number;
	/**
	 * Read handle on the full-text index, or null while there is none (the
	 * plugin has not started it yet, or the host does not have one).
	 *
	 * Optional so a host that has not been wired up yet still compiles and
	 * still works: every source treats "absent" as "no index", which is what
	 * the bar did before the index had any reader at all.
	 */
	index?: FullTextIndex | null;
	/**
	 * The user settings the sources read. Optional for the same reason as
	 * `index`; absent means DEFAULT_SOURCE_SETTINGS. Read it through
	 * `sourceSettings(ctx)` rather than dereferencing it, so the default is
	 * applied in exactly one place.
	 */
	settings?: SourceSettings;
}

/** The settings this context carries, or the documented defaults. */
export function sourceSettings(ctx: SourceContext): SourceSettings {
	return ctx.settings ?? DEFAULT_SOURCE_SETTINGS;
}

/**
 * The exclusion predicate for this query. Build it ONCE per getCandidates and
 * reuse it per file — that is the whole point of `pathExcluder`, and with no
 * excluded folders configured it is a constant `false` that costs nothing.
 */
export function excluderFor(ctx: SourceContext): (path: string) => boolean {
	return pathExcluder(sourceSettings(ctx).excludedFolders);
}

/** The index handle this context carries, or null. */
export function fullTextIndexOf(ctx: SourceContext): FullTextIndex | null {
	return ctx.index ?? null;
}

export interface Source {
	id: string;
	/**
	 * False when the sigil scope, the filter row or a missing plugin rules
	 * this source out entirely. Checked before getCandidates, so a disabled
	 * source costs nothing.
	 */
	appliesTo(ctx: SourceContext): boolean;
	/**
	 * Synchronous sources return an array and render in the first paint.
	 * Anything that touches the disk returns a promise and streams in behind
	 * a loading state — see StreamingSource.
	 */
	getCandidates(ctx: SourceContext): Candidate[];
}

/**
 * A source too slow to block the first paint (full-text over file contents).
 * The modal renders every sync source immediately, then folds these in as
 * they land. Callers must honour the AbortSignal: a keystroke invalidates the
 * request in flight, and a late result overwriting a newer one is the single
 * most common bug in incremental search UIs.
 */
export interface StreamingSource {
	id: string;
	/**
	 * Explicit marker rather than a guess. Sniffing `getCandidates.length >= 2`
	 * looked clever and was wrong twice over: a default parameter or a rest
	 * signature silently reports the wrong arity, and a misdetected source
	 * gets spread as an array — `TypeError: … is not iterable`, swallowed into
	 * an unhandled rejection because getSuggestions is async.
	 */
	readonly streaming: true;
	appliesTo(ctx: SourceContext): boolean;
	getCandidates(ctx: SourceContext, signal: AbortSignal): Promise<Candidate[]>;
}

export function isStreaming(source: Source | StreamingSource): source is StreamingSource {
	return (source as StreamingSource).streaming === true;
}

/**
 * Wrap an ordered list into candidates, normalizing by POSITION rather than
 * by score. The safe default whenever a source's native score range is
 * unknown or incomparable: position is information, magnitude is not.
 */
export function candidatesFromOrdered(items: readonly OmniItem[]): Candidate[] {
	const n = items.length;
	return items.map((item, i) => ({ item, norm: n <= 1 ? 1 : 1 - i / n }));
}
