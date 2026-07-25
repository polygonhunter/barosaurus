import type { App } from "obsidian";
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
export interface SourceContext {
	app: App;
	/** The editing situation: selection, active file, view type, now. */
	bar: BarContext;
	/** Parsed input, including the sigil scope that may exclude this source. */
	query: ParsedQuery;
	/** Upper bound on returned candidates. Sources must respect it. */
	limit: number;
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
	appliesTo(ctx: SourceContext): boolean;
	getCandidates(ctx: SourceContext, signal: AbortSignal): Promise<Candidate[]>;
}

export function isStreaming(source: Source | StreamingSource): source is StreamingSource {
	return (
		(source as StreamingSource).getCandidates.length >= 2 &&
		!Array.isArray((source as Source).getCandidates)
	);
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
