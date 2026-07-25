import { acronym, fold, foldedWords } from "./normalize";
import type { BarContext, Candidate, OmniItem, TypeWeights } from "./types";
import {
	DEFAULT_TYPE_WEIGHTS,
	TIER_ACRONYM,
	TIER_CONTIGUOUS,
	TIER_EXACT,
	TIER_FUZZY,
	TIER_PREFIX,
} from "./types";

/**
 * The bar's reason to exist, in one function.
 *
 * Mixing commands, files, headings and tags in ONE list is only possible if
 * their scores never meet. MiniSearch hands out positive BM25, obsidian's
 * prepareFuzzySearch hands out negative numbers, a tab list has no score at
 * all — sorting those against each other buries whole sources regardless of
 * match quality. So the comparison happens in two layers:
 *
 *   1. TIER — computed here, from the query and the item's own title and
 *      aliases. Identical rules for every source, so "exact title match" means
 *      the same thing for a command and for a note. The tier dominates.
 *   2. SCORE — only breaks ties inside a tier, and only after each source has
 *      rank-normalized its own candidates to [0,1] (Candidate.norm).
 *
 * Frecency is added to the score rather than replacing it, which is the part
 * no other plugin does: what you use most keeps its pull WHILE you type,
 * instead of only decorating the empty state.
 */

export interface RankOptions {
	typeWeights?: TypeWeights;
	/** id → bounded [0,1] frecency boost, from core/frecency. */
	frecency?: Readonly<Record<string, number>>;
	/** Ids the user pinned; they lead their tier. */
	pinned?: ReadonlySet<string>;
	/** id → additive boost from the editing situation, from core/context. */
	contextBoost?: Readonly<Record<string, number>>;
}

export interface RankedItem {
	item: OmniItem;
	tier: number;
	score: number;
}

const PIN_BOOST = 0.5;

/**
 * Tier of a single item against an already-folded query.
 *
 * Ordering rationale: an exact title beats a prefix beats a contiguous
 * substring beats an acronym beats a scattered fuzzy hit. Aliases count fully
 * at every tier — "fett" must reach Bold exactly as well as "bold" does,
 * which is why every term goes through fold() (ß→ss, umlauts, punctuation).
 */
export function tierOf(item: OmniItem, foldedQuery: string, queryWords: readonly string[]): number {
	if (foldedQuery.length === 0) return TIER_FUZZY;

	const terms = [item.title, ...item.aliases].map(fold);

	for (const term of terms) if (term === foldedQuery) return TIER_EXACT;
	for (const term of terms) if (term.startsWith(foldedQuery)) return TIER_PREFIX;

	// Multi-word queries also prefix-match word by word: "to bo" → "Toggle bold".
	if (queryWords.length > 1) {
		for (const term of terms) {
			if (wordsPrefixMatchInOrder(queryWords, term.split(" "))) return TIER_PREFIX;
		}
	}

	// Contiguous: the query appears as an unbroken run anywhere in the term.
	for (const term of terms) if (term.includes(foldedQuery)) return TIER_CONTIGUOUS;

	// Acronym: "tb" → "Toggle bold", "h2" → "Heading 2".
	const compact = foldedQuery.replace(/\s+/g, "");
	for (const term of [item.title, ...item.aliases]) {
		const initials = acronym(term);
		if (initials.length > 1 && initials.startsWith(compact)) return TIER_ACRONYM;
	}

	return TIER_FUZZY;
}

/** Every query word prefix-matches a distinct term word, left to right. */
function wordsPrefixMatchInOrder(
	queryWords: readonly string[],
	termWords: readonly string[],
): boolean {
	let position = 0;
	for (const queryWord of queryWords) {
		let matched = false;
		while (position < termWords.length) {
			const termWord = termWords[position];
			position += 1;
			if (termWord !== undefined && termWord.startsWith(queryWord)) {
				matched = true;
				break;
			}
		}
		if (!matched) return false;
	}
	return true;
}

/**
 * Order candidates from every source into one list.
 *
 * Deliberately does NOT filter: each source has already decided what counts
 * as a match for it. Ranking that also filtered would make a source's recall
 * depend on the ranker's opinion, which is how mixed lists get holes.
 */
export function rankCandidates(
	candidates: readonly Candidate[],
	query: string,
	ctx: BarContext,
	options: RankOptions = {},
): RankedItem[] {
	const weights = options.typeWeights ?? DEFAULT_TYPE_WEIGHTS;
	const frecency = options.frecency ?? {};
	const pinned = options.pinned ?? new Set<string>();
	const contextBoost = options.contextBoost ?? {};

	const foldedQuery = fold(query);
	const queryWords = foldedWords(query);

	// Decorate rather than memoize by object identity: a Map keyed on the
	// candidate object breaks the moment a caller reuses or caches an array.
	const ranked: RankedItem[] = candidates.map((candidate) => {
		const { item, norm } = candidate;
		const tier = tierOf(item, foldedQuery, queryWords);
		const score =
			norm * (weights[item.source] ?? 0.5) +
			(frecency[item.id] ?? 0) +
			(contextBoost[item.id] ?? 0) +
			(pinned.has(item.id) ? PIN_BOOST : 0);
		return { item, tier, score };
	});

	ranked.sort((a, b) => {
		if (a.tier !== b.tier) return a.tier - b.tier;
		if (b.score !== a.score) return b.score - a.score;
		// Within a title tier the shortest title is the most exact match.
		if (a.tier <= TIER_PREFIX && a.item.title.length !== b.item.title.length) {
			return a.item.title.length - b.item.title.length;
		}
		// Stable, deterministic last resort — never leave order up to the engine.
		return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
	});

	// ctx is part of the signature because contextBoost is derived from it and
	// callers should not be able to rank without having considered it.
	void ctx;
	return ranked;
}

/**
 * Rank-normalize one source's own ordering into [0,1]. The safe default when
 * a source's native score range is unknown or incomparable — position is
 * information, magnitude is not.
 */
export function normalizeByRank<T>(ordered: readonly T[]): Array<{ value: T; norm: number }> {
	const n = ordered.length;
	return ordered.map((value, i) => ({ value, norm: n <= 1 ? 1 : 1 - i / n }));
}
