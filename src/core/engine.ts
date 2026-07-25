import MiniSearch, { type Options, type Query, type SearchOptions } from "minisearch";
import type { FieldWeights, IndexedDoc, SearchHit } from "./index-types";
import { processTerm } from "./normalize";

/** Bump when the doc schema or normalization changes → forces a rebuild. */
export const INDEX_SCHEMA_VERSION = 1;

const INDEX_FIELDS = [
	"basename",
	"aliases",
	"headings",
	"tags",
	"body",
	"extractedText",
	"url",
] as const;

const STORE_FIELDS = [
	"path",
	"kind",
	"mtime",
	"basename",
	"aliasList",
	"tagList",
	"url",
	"line",
] as const;

/** Title-focused subset, for callers that want titles only (no body). */
export const TITLE_FIELDS: readonly string[] = ["basename", "aliases", "url"];

function miniSearchOptions(weights: FieldWeights): Options<IndexedDoc> {
	return {
		idField: "id",
		fields: [...INDEX_FIELDS],
		storeFields: [...STORE_FIELDS],
		// The SAME processTerm the tier checks in core/rank.ts fold with. If
		// these ever diverge, umlaut titles silently stop matching.
		processTerm,
		searchOptions: {
			prefix: (term) => term.length >= 2,
			fuzzy: (term) => (term.length >= 4 ? 0.2 : false),
			combineWith: "AND",
			boost: { ...weights },
		},
	};
}

/**
 * Thin wrapper around MiniSearch: upsert/discard semantics, typed hits and
 * stable JSON serialization for the startup cache.
 *
 * Pure — the Obsidian side (src/index/) feeds it docs, the sources layer
 * reads hits. Nothing here imports obsidian, so the tests need no shim.
 */
export class SearchEngine {
	private mini: MiniSearch<IndexedDoc>;

	constructor(private readonly weights: FieldWeights) {
		this.mini = new MiniSearch(miniSearchOptions(weights));
	}

	/** Add or replace — MiniSearch's replace() throws on unknown ids. */
	upsert(doc: IndexedDoc): void {
		if (this.mini.has(doc.id)) {
			this.mini.replace(doc);
		} else {
			this.mini.add(doc);
		}
	}

	/** Remove by id; no-op when absent. discard() is v7's cheap removal. */
	remove(id: string): void {
		if (this.mini.has(id)) this.mini.discard(id);
	}

	has(id: string): boolean {
		return this.mini.has(id);
	}

	get size(): number {
		return this.mini.documentCount;
	}

	search(query: string, options?: SearchOptions): SearchHit[] {
		if (query.trim().length === 0) return [];
		return this.mini.search(query, options) as unknown as SearchHit[];
	}

	/**
	 * Search with exclusions: hits matching any `excludes` term are dropped
	 * via MiniSearch's AND_NOT combinator (its only NOT form). This is what
	 * backs the `-word` operator in core/query.ts.
	 */
	searchWithExcludes(
		query: string,
		excludes: readonly string[],
		options?: SearchOptions,
	): SearchHit[] {
		if (query.trim().length === 0) return [];
		if (excludes.length === 0) return this.search(query, options);
		const combined: Query = {
			combineWith: "AND_NOT",
			queries: [query, { combineWith: "OR", queries: [...excludes] }],
		};
		return this.mini.search(combined, options) as unknown as SearchHit[];
	}

	toJSON(): string {
		return JSON.stringify(this.mini.toJSON());
	}

	/** Replace the whole index from a serialized snapshot. */
	load(json: string): void {
		this.mini = MiniSearch.loadJSON(json, miniSearchOptions(this.weights));
	}

	/** Drop everything (rebuild path). */
	clear(): void {
		this.mini = new MiniSearch(miniSearchOptions(this.weights));
	}
}
