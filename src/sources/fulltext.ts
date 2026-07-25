import type { SearchHit } from "../core/index-types";
import { fold } from "../core/normalize";
import { folderOf } from "../core/paths";
import { containsPhrase, matchesTag, type ParsedQuery } from "../core/query";
import type { Candidate, OmniItem, ResultKind, TileSpec } from "../core/types";
import {
	candidatesFromOrdered,
	excluderFor,
	fullTextIndexOf,
	sourceSettings,
	type SourceContext,
	type StreamingSource,
} from "./source";

/**
 * Notes and files, TEXT level: the reader of the full-text index.
 *
 * Everything else in the bar matches titles. This is the source that answers
 * "I know I wrote it down somewhere" — the note body, the headings, the tags,
 * the URLs of links inside notes, and the OCR / PDF text that src/ocr writes
 * into the index. Without it the whole index layer is a write-only cache.
 *
 * Three properties make it safe to mix into the list:
 *
 *  1. It is a StreamingSource. Reading the index is a memory operation, but a
 *     large one, and phrase verification touches the disk — neither may block
 *     the first paint of the title matches.
 *  2. It normalizes by RANK, never by MiniSearch's BM25. That score is
 *     positive and unbounded while prepareFuzzySearch's is negative; putting
 *     either into the shared comparator sinks or floats a whole category.
 *  3. It carries its own id namespace, so a file that the title-matching files
 *     source already returned can be dropped by the caller — see
 *     `dedupeFullText`, which the modal must run before ranking.
 *
 * Nothing here imports obsidian, not even for types: `ctx.app` is enough, and
 * staying import-free is what lets tests/fulltext.test.ts run under plain
 * vitest with a fake index and a fake vault.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Shortest query worth asking the index.
 *
 * Three, and the reason is in engine.ts: the index expands every term with
 * `prefix: term.length >= 2`. A two-letter query therefore matches every word
 * in the vault beginning with those two letters — hundreds of notes, ordered
 * by a BM25 that means nothing at that recall, rendered under a "Found in
 * text" label that promises the opposite. At three letters the expansion is
 * about a word rather than about an alphabet slice. It also keeps the index
 * out of the way while the user is still typing the first syllable, which is
 * exactly when the title sources are at their most useful.
 */
const MIN_QUERY_LENGTH = 3;

/**
 * How far down the hit list the post-filters may look before giving up.
 * MiniSearch returns EVERY matching document, so a common word can produce
 * thousands of hits; filters that reject most of them must not turn one
 * keystroke into a full scan.
 */
const SCAN_OVERSCAN = 200;

/**
 * How many notes a quoted query may read from disk to prove its phrase.
 * Deliberately small: the read is `cachedRead`, but folding a note body is
 * regex work and this happens per keystroke.
 */
const PHRASE_READ_CAP = 12;

/**
 * How much of a body a phrase may be verified against. The indexer truncates
 * at the same length (MAX_BODY_LENGTH in src/index/content.ts), so text past
 * it was never indexed and could not have produced the hit anyway.
 */
const MAX_PHRASE_BODY = 300_000;

/** The `kind: "file"` member of the OmniItem union, which is what we emit. */
type FileItem = Extract<OmniItem, { kind: "file" }>;

/**
 * The id namespace of a full-text row. Distinct from `fileItemId()` on
 * purpose: the same file can be offered by the files source (title match) and
 * by this one (text match) in a single result set, and two rows sharing an id
 * would collide in the modal's ordinal and highlight maps.
 */
export function fullTextItemId(path: string): string {
	return `fulltext:${path}`;
}

// ------------------------------------------------------------------ filtering

/** Mirrors the files source: "file" is the generic bucket and excludes nothing. */
function matchesKind(hitKind: ResultKind, queryKind: ResultKind | null): boolean {
	if (queryKind === null || queryKind === "file") return true;
	return hitKind === queryKind;
}

/**
 * Everything the index cannot decide for itself. `-word` exclusions are NOT
 * here — those go into MiniSearch as AND_NOT, which is both cheaper and the
 * reason `searchWithExcludes` exists.
 */
function passesFilters(
	hit: SearchHit,
	query: ParsedQuery,
	now: number,
	isExcluded: (path: string) => boolean,
): boolean {
	// The index is diffed against the exclusion list, but a snapshot loaded
	// from IndexedDB predates the folder the user excluded five seconds ago.
	if (isExcluded(hit.path)) return false;
	if (!matchesKind(hit.kind, query.kind)) return false;

	if (query.pathPrefix !== null) {
		if (!hit.path.toLowerCase().startsWith(query.pathPrefix.toLowerCase())) return false;
	}

	if (query.modifiedWithinDays !== null) {
		if (now - hit.mtime > query.modifiedWithinDays * DAY_MS) return false;
	}

	if (query.tags.length > 0) {
		const tags = hit.tagList;
		if (tags.length === 0) return false;
		for (const tag of query.tags) if (!matchesTag(tags, tag)) return false;
	}

	return true;
}

/** Everything about a hit the index actually stored, as one haystack. */
function storedText(hit: SearchHit): string {
	const parts = [hit.basename, ...hit.aliasList, hit.path, ...hit.tagList];
	if (hit.url !== undefined && hit.url.length > 0) parts.push(hit.url);
	return parts.join(" ");
}

/**
 * Verify `"quoted phrases"` verbatim.
 *
 * The index cannot do this: MiniSearch has no phrase operator, and the query
 * it was handed contains the phrase's WORDS, so it matched a note that has
 * them scattered. The stored fields answer the cheap cases (a phrase in the
 * title, an alias, the path, a tag or a URL). Anything else can only be in the
 * body — which engine.ts indexes but does not store, so it has to be read.
 *
 * Two things are deliberately given up here. Reads are capped, so a quoted
 * query over a huge result set verifies the best hits and drops the tail; and
 * attachments cannot be verified at all, because their extracted text lives
 * only inside the index. A quoted query therefore does not reach OCR text —
 * an unquoted one does.
 */
async function verifyPhrases(
	ctx: SourceContext,
	hits: readonly SearchHit[],
	signal: AbortSignal,
	want: number,
): Promise<SearchHit[]> {
	const { app, query } = ctx;
	const out: SearchHit[] = [];
	let reads = 0;

	for (const hit of hits) {
		if (out.length >= want || signal.aborted) break;

		const stored = storedText(hit);
		if (query.phrases.every((phrase) => containsPhrase(stored, phrase))) {
			out.push(hit);
			continue;
		}
		if (hit.kind !== "note" || reads >= PHRASE_READ_CAP) continue;

		const file = app.vault.getFileByPath(hit.path);
		if (file === null) continue;
		reads += 1;
		let body: string;
		try {
			// cachedRead is the documented read for "I only want to look at it";
			// a file deleted between the index and now simply drops out.
			body = (await app.vault.cachedRead(file)).slice(0, MAX_PHRASE_BODY);
		} catch (error) {
			console.error(`Barosaurus: could not read ${hit.path} to verify a phrase`, error);
			continue;
		}
		// The await is a window in which the user typed again.
		if (signal.aborted) break;
		if (query.phrases.every((phrase) => containsPhrase(body, phrase))) out.push(hit);
	}

	return out;
}

// --------------------------------------------------------------------- items

function tileFor(hit: SearchHit): TileSpec {
	if (hit.kind === "image") return { kind: "thumbnail", path: hit.path };
	if (hit.kind === "note") return { kind: "icon", icon: "file-text" };
	if (hit.kind === "link") return { kind: "icon", icon: "link" };
	return { kind: "icon", icon: "file" };
}

/**
 * The row.
 *
 * The subtitle says WHERE, because the row cannot say what: the matching text
 * is in the body, and the body is indexed but not stored, so a real snippet
 * would cost one file read per row per keystroke. A link doc shows its URL
 * (which IS the matched text), everything else shows its folder — the same
 * subtitle the files source uses, so the two lists read alike.
 *
 * No SearchResult is attached. The offsets we could compute cheaply would be
 * offsets into FOLDED text (ß→ss and NFD both change the length), and the
 * modal's own fallback highlighter runs against the real title and is correct.
 */
function itemFor(hit: SearchHit): OmniItem {
	const item: FileItem = {
		id: fullTextItemId(hit.path),
		kind: "file",
		source: "fulltext",
		group: "fulltext",
		title: hit.basename,
		aliases: hit.aliasList,
		tile: tileFor(hit),
		path: hit.path,
		resultKind: hit.kind,
		mtime: hit.mtime,
		contextTags: ["vault"],
	};
	const subtitle =
		hit.kind === "link" && hit.url !== undefined && hit.url.length > 0
			? hit.url
			: folderOf(hit.path);
	if (subtitle !== undefined) item.subtitle = subtitle;
	// A link doc knows the line it sits on, which is what makes "open at the
	// place it matched" possible for the one hit kind that can offer it.
	if (hit.line !== undefined) item.line = hit.line;
	return item;
}

// -------------------------------------------------------------------- source

export const fullTextSource: StreamingSource = {
	id: "fulltext",
	streaming: true,

	/**
	 * Unscoped queries only, with the setting on, an index that has something
	 * in it, and enough typed to be worth asking. ">" is the command palette,
	 * "@" is this note's outline and ":42" is a jump — none of them mean "look
	 * inside every file in the vault", and answering them anyway is how a
	 * scoped list stops being scoped.
	 */
	appliesTo(ctx: SourceContext): boolean {
		if (ctx.query.scope !== "all") return false;
		if (!sourceSettings(ctx).fullTextSearch) return false;
		const index = fullTextIndexOf(ctx);
		if (index === null || index.size === 0) return false;
		return fold(ctx.query.text).length >= MIN_QUERY_LENGTH;
	},

	async getCandidates(ctx: SourceContext, signal: AbortSignal): Promise<Candidate[]> {
		const { query, limit } = ctx;
		if (limit <= 0 || signal.aborted) return [];
		const index = fullTextIndexOf(ctx);
		if (index === null) return [];

		const isExcluded = excluderFor(ctx);
		const now = ctx.bar.now > 0 ? ctx.bar.now : Date.now();

		// No prefilter and no prepareFuzzySearch: the inverted index IS the
		// prefilter, which is the entire reason it exists. `-word` exclusions
		// go in as AND_NOT rather than being filtered out afterwards, so an
		// excluded term never makes it into the hit list to begin with.
		let hits: readonly SearchHit[];
		try {
			hits = index.searchWithExcludes(query.text, query.excludes);
		} catch (error) {
			console.error("Barosaurus: the full-text index failed to answer", error);
			return [];
		}
		// The search itself is synchronous and uninterruptible; this is the
		// first moment we can notice that a newer keystroke owns the list.
		if (signal.aborted) return [];

		// Overshoot when a phrase still has to be proven, so verification that
		// rejects a few hits does not shorten the list below the limit.
		const want = query.phrases.length === 0 ? limit : Math.min(limit * 2, limit + PHRASE_READ_CAP);
		const scanCap = want + SCAN_OVERSCAN;

		const kept: SearchHit[] = [];
		const seen = new Set<string>();
		for (let i = 0; i < hits.length && i < scanCap && kept.length < want; i += 1) {
			const hit = hits[i];
			if (hit === undefined) continue;
			// One row per FILE. A note and every link doc inside it are separate
			// index documents sharing a path; three rows for one note is noise.
			if (seen.has(hit.path)) continue;
			if (!passesFilters(hit, query, now, isExcluded)) continue;
			seen.add(hit.path);
			kept.push(hit);
		}

		const verified =
			query.phrases.length === 0 ? kept : await verifyPhrases(ctx, kept, signal, limit);
		if (signal.aborted) return [];

		// Rank normalization, never score normalization — see the header.
		return candidatesFromOrdered(verified.slice(0, limit).map(itemFor));
	},
};

// ------------------------------------------------------------------- caller

/**
 * Drop full-text rows for files a title-matching source already returned.
 *
 * Sources cannot see each other, so neither of them can do this: the files
 * source does not know what the index found, and this source does not know
 * which titles matched. The caller that holds both lists does — which is why
 * this is exported as a pure function rather than hidden inside the source.
 *
 * Run it on the COMBINED candidate list, before ranking. Dropping the
 * duplicate after ranking would leave a hole in the per-group caps and could
 * spend a "Found in text" slot on a row that is never rendered.
 */
export function dedupeFullText(candidates: readonly Candidate[]): Candidate[] {
	const titled = new Set<string>();
	for (const { item } of candidates) {
		if (item.kind === "file" && item.source === "file") titled.add(item.path);
	}
	if (titled.size === 0) return [...candidates];
	return candidates.filter(
		({ item }) =>
			!(item.kind === "file" && item.source === "fulltext" && titled.has(item.path)),
	);
}

/**
 * True when an empty full-text answer means "not yet" rather than "nothing
 * there" — the bar should say "Indexing…" instead of "No matches" while the
 * first build is still running.
 */
export function fullTextPending(ctx: SourceContext): boolean {
	const index = fullTextIndexOf(ctx);
	return index !== null && index.busy && sourceSettings(ctx).fullTextSearch;
}
