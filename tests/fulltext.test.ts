import type { App } from "obsidian";
import { describe, expect, it } from "vitest";
import type { SearchHit } from "../src/core/index-types";
import { parseQuery } from "../src/core/query";
import { EMPTY_CONTEXT, type Candidate, type OmniItem } from "../src/core/types";
import {
	dedupeFullText,
	fullTextItemId,
	fullTextPending,
	fullTextSource,
} from "../src/sources/fulltext";
import type { FullTextIndex, SourceContext, SourceSettings } from "../src/sources/source";

/**
 * The full-text source, tested with no Obsidian anywhere.
 *
 * That is the whole reason SourceContext takes a `FullTextIndex` interface
 * instead of the Indexer class: the index is a five-line fake here, the vault
 * is a Record<path, body>, and the suite still runs under plain vitest.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function hit(path: string, overrides: Partial<SearchHit> = {}): SearchHit {
	const file = path.slice(path.lastIndexOf("/") + 1);
	return {
		id: path,
		score: 1,
		kind: "note",
		path,
		basename: file.endsWith(".md") ? file.slice(0, -3) : file,
		mtime: NOW,
		aliasList: [],
		tagList: [],
		...overrides,
	};
}

interface FakeIndex extends FullTextIndex {
	/** Every (query, excludes) pair the source asked for. */
	readonly calls: Array<{ query: string; excludes: readonly string[] }>;
}

function fakeIndex(hits: readonly SearchHit[], options: { busy?: boolean; throws?: boolean } = {}) {
	const calls: Array<{ query: string; excludes: readonly string[] }> = [];
	const index: FakeIndex = {
		calls,
		busy: options.busy ?? false,
		size: hits.length,
		search(query: string) {
			calls.push({ query, excludes: [] });
			if (options.throws === true) throw new Error("index exploded");
			return hits;
		},
		searchWithExcludes(query: string, excludes: readonly string[]) {
			calls.push({ query, excludes });
			if (options.throws === true) throw new Error("index exploded");
			return hits;
		},
	};
	return index;
}

/** A vault that is nothing but a path → body map. */
function fakeApp(bodies: Readonly<Record<string, string>> = {}): App {
	return {
		vault: {
			getFileByPath: (path: string) =>
				Object.prototype.hasOwnProperty.call(bodies, path) ? { path } : null,
			cachedRead: (file: { path: string }) => Promise.resolve(bodies[file.path] ?? ""),
		},
	} as unknown as App;
}

const ON: SourceSettings = {
	excludedFolders: [],
	hideUnavailableCommands: true,
	hiddenCommands: [],
	fullTextSearch: true,
};

function contextFor(
	raw: string,
	options: {
		index?: FullTextIndex | null;
		settings?: Partial<SourceSettings>;
		limit?: number;
		app?: App;
	} = {},
): SourceContext {
	return {
		app: options.app ?? fakeApp(),
		bar: { ...EMPTY_CONTEXT, now: NOW },
		query: parseQuery(raw),
		limit: options.limit ?? 10,
		index: options.index === undefined ? fakeIndex([hit("a.md")]) : options.index,
		settings: { ...ON, ...options.settings },
	};
}

function run(ctx: SourceContext, signal = new AbortController().signal): Promise<Candidate[]> {
	return fullTextSource.getCandidates(ctx, signal);
}

function paths(candidates: readonly Candidate[]): string[] {
	return candidates.map(({ item }) => (item.kind === "file" ? item.path : item.id));
}

// ------------------------------------------------------------------ contract

describe("fullTextSource, the contract", () => {
	it("is marked streaming explicitly", () => {
		expect(fullTextSource.streaming).toBe(true);
		expect(fullTextSource.id).toBe("fulltext");
	});

	it("answers only the unscoped query", () => {
		expect(fullTextSource.appliesTo(contextFor("meeting"))).toBe(true);
		// ">" is the command palette, "@" this note's outline, ":42" a jump —
		// none of them mean "read every file in the vault".
		expect(fullTextSource.appliesTo(contextFor(">meeting"))).toBe(false);
		expect(fullTextSource.appliesTo(contextFor("@meeting"))).toBe(false);
		expect(fullTextSource.appliesTo(contextFor(":42"))).toBe(false);
	});

	it("is off when the setting is off", () => {
		expect(fullTextSource.appliesTo(contextFor("meeting", { settings: { fullTextSearch: false } })))
			.toBe(false);
	});

	it("is off without an index, and while the index is still empty", () => {
		expect(fullTextSource.appliesTo(contextFor("meeting", { index: null }))).toBe(false);
		expect(fullTextSource.appliesTo(contextFor("meeting", { index: fakeIndex([]) }))).toBe(false);
	});

	it("is off with no host settings at all — an unwired host must not query", () => {
		const ctx: SourceContext = { ...contextFor("meeting"), settings: undefined, index: undefined };
		expect(fullTextSource.appliesTo(ctx)).toBe(false);
	});

	it("waits for a query long enough to be worth the recall", () => {
		expect(fullTextSource.appliesTo(contextFor("me"))).toBe(false);
		expect(fullTextSource.appliesTo(contextFor("mee"))).toBe(true);
		// Folded length decides, so punctuation does not buy the threshold.
		expect(fullTextSource.appliesTo(contextFor("m-"))).toBe(false);
	});

	it("still applies once a kind operator narrows the corpus", () => {
		expect(fullTextSource.appliesTo(contextFor("n meeting"))).toBe(true);
		expect(fullTextSource.appliesTo(contextFor("l react"))).toBe(true);
	});
});

// -------------------------------------------------------------------- shape

describe("fullTextSource, the rows it emits", () => {
	it("emits file rows in its own namespace and its own group", async () => {
		const ctx = contextFor("meeting", { index: fakeIndex([hit("notes/standup.md")]) });
		const [candidate] = await run(ctx);
		expect(candidate).toBeDefined();
		const item = candidate?.item as OmniItem & { kind: "file" };
		expect(item.kind).toBe("file");
		expect(item.source).toBe("fulltext");
		expect(item.group).toBe("fulltext");
		expect(item.id).toBe(fullTextItemId("notes/standup.md"));
		// NOT the files source's id — two rows for one file must not collide in
		// the modal's ordinal and highlight maps.
		expect(item.id).not.toBe("file:notes/standup.md");
		expect(item.title).toBe("standup");
		expect(item.subtitle).toBe("notes");
	});

	it("omits the subtitle at the vault root", async () => {
		const [candidate] = await run(contextFor("meeting", { index: fakeIndex([hit("standup.md")]) }));
		expect((candidate?.item as OmniItem & { kind: "file" }).subtitle).toBeUndefined();
	});

	it("shows a link's URL and the line it sits on", async () => {
		const link = hit("notes/reading.md", {
			id: "notes/reading.md::L20",
			kind: "link",
			basename: "The React docs",
			url: "https://react.dev/learn",
			line: 12,
		});
		const [candidate] = await run(contextFor("react", { index: fakeIndex([link]) }));
		const item = candidate?.item as OmniItem & { kind: "file" };
		expect(item.subtitle).toBe("https://react.dev/learn");
		expect(item.line).toBe(12);
		expect(item.resultKind).toBe("link");
	});

	it("normalizes by rank, never by the index's own score", async () => {
		const hits = [
			hit("a.md", { score: 812.5 }),
			hit("b.md", { score: 811.9 }),
			hit("c.md", { score: 0.004 }),
		];
		const candidates = await run(contextFor("meeting", { index: fakeIndex(hits) }));
		expect(candidates.map((entry) => entry.norm)).toEqual([1, 1 - 1 / 3, 1 - 2 / 3]);
		// BM25 is positive and unbounded; nothing of it may reach the ranker.
		expect(candidates.every((entry) => entry.norm <= 1 && entry.norm >= 0)).toBe(true);
	});

	it("respects the limit", async () => {
		const hits = Array.from({ length: 50 }, (_, i) => hit(`n${i}.md`));
		expect(await run(contextFor("meeting", { index: fakeIndex(hits), limit: 4 }))).toHaveLength(4);
		expect(await run(contextFor("meeting", { index: fakeIndex(hits), limit: 0 }))).toHaveLength(0);
	});

	it("returns one row per file, not one per index document", async () => {
		// A note and every external link inside it are separate documents that
		// share a path.
		const hits = [
			hit("notes/reading.md", { id: "notes/reading.md::L4", kind: "link", url: "https://a" }),
			hit("notes/reading.md"),
			hit("notes/reading.md", { id: "notes/reading.md::L9", kind: "link", url: "https://b" }),
		];
		expect(paths(await run(contextFor("react", { index: fakeIndex(hits) })))).toEqual([
			"notes/reading.md",
		]);
	});
});

// ------------------------------------------------------------------ filters

describe("fullTextSource, the filters the index cannot apply", () => {
	it("hands -word exclusions to the index rather than filtering afterwards", async () => {
		const index = fakeIndex([hit("a.md")]);
		await run(contextFor("meeting -cancelled", { index }));
		expect(index.calls).toEqual([{ query: "meeting", excludes: ["cancelled"] }]);
	});

	it("skips excluded folders even when the index still holds them", async () => {
		const hits = [hit("templates/daily.md"), hit("templates-archive/x.md"), hit("notes/a.md")];
		const candidates = await run(
			contextFor("meeting", { index: fakeIndex(hits), settings: { excludedFolders: ["templates"] } }),
		);
		// Boundary-aware: "templates" must not take "templates-archive" with it.
		expect(paths(candidates)).toEqual(["templates-archive/x.md", "notes/a.md"]);
	});

	it("honours p: as a case-insensitive path prefix", async () => {
		const hits = [hit("Projects/a.md"), hit("notes/b.md")];
		expect(paths(await run(contextFor("meeting p:projects", { index: fakeIndex(hits) })))).toEqual([
			"Projects/a.md",
		]);
	});

	it("honours mod: against the injected clock", async () => {
		const hits = [
			hit("fresh.md", { mtime: NOW - 2 * DAY_MS }),
			hit("stale.md", { mtime: NOW - 40 * DAY_MS }),
		];
		expect(paths(await run(contextFor("meeting mod:week", { index: fakeIndex(hits) })))).toEqual([
			"fresh.md",
		]);
	});

	it("honours #tag, including nested tags by prefix", async () => {
		const hits = [
			hit("a.md", { tagList: ["project/design"] }),
			hit("b.md", { tagList: ["projection"] }),
			hit("c.md", { tagList: [] }),
		];
		expect(paths(await run(contextFor("meeting #project", { index: fakeIndex(hits) })))).toEqual([
			"a.md",
		]);
	});

	it("honours the kind operator, and treats f as the generic bucket", async () => {
		const hits = [
			hit("note.md"),
			hit("shot.png", { kind: "image" }),
			hit("paper.pdf", { kind: "file" }),
			hit("note.md", { id: "note.md::L1", kind: "link", url: "https://x" }),
		];
		expect(paths(await run(contextFor("n meeting", { index: fakeIndex(hits) })))).toEqual([
			"note.md",
		]);
		expect(paths(await run(contextFor("i meeting", { index: fakeIndex(hits) })))).toEqual([
			"shot.png",
		]);
		expect(paths(await run(contextFor("f meeting", { index: fakeIndex(hits) })))).toHaveLength(3);
	});
});

// ------------------------------------------------------------------ phrases

describe("fullTextSource, quoted phrases", () => {
	it("accepts a phrase that the stored fields already prove", async () => {
		const hits = [hit("notes/Design Review.md"), hit("notes/other.md")];
		const candidates = await run(
			contextFor('"design review"', { index: fakeIndex(hits), app: fakeApp({}) }),
		);
		expect(paths(candidates)).toEqual(["notes/Design Review.md"]);
	});

	it("reads the note to prove a phrase that can only be in the body", async () => {
		const app = fakeApp({
			"a.md": "…we agreed on the DESIGN review before Friday…",
			"b.md": "design happened, and a review happened, but never together",
		});
		const candidates = await run(
			contextFor('"design review"', { index: fakeIndex([hit("a.md"), hit("b.md")]), app }),
		);
		// The index matched both — it has no phrase operator, only AND over the
		// phrase's words. Only the disk can tell them apart.
		expect(paths(candidates)).toEqual(["a.md"]);
	});

	it("drops an attachment whose phrase could only be in unstored extracted text", async () => {
		const hits = [hit("scan.png", { kind: "image" })];
		expect(paths(await run(contextFor('"design review"', { index: fakeIndex(hits) })))).toEqual([]);
	});
});

// -------------------------------------------------------------------- abort

describe("fullTextSource, the AbortSignal", () => {
	it("never touches the index once the query is stale", async () => {
		const index = fakeIndex([hit("a.md")]);
		const controller = new AbortController();
		controller.abort();
		expect(await run(contextFor("meeting", { index }), controller.signal)).toEqual([]);
		expect(index.calls).toEqual([]);
	});

	it("drops a result the user has already typed past", async () => {
		const controller = new AbortController();
		const index: FullTextIndex = {
			busy: false,
			size: 1,
			search: () => [hit("a.md")],
			searchWithExcludes: () => {
				// The search is synchronous and uninterruptible; the keystroke
				// lands while it runs.
				controller.abort();
				return [hit("a.md")];
			},
		};
		expect(await run(contextFor("meeting", { index }), controller.signal)).toEqual([]);
	});

	it("survives an index that throws instead of answering", async () => {
		const index = fakeIndex([hit("a.md")], { throws: true });
		expect(await run(contextFor("meeting", { index }))).toEqual([]);
	});
});

// ------------------------------------------------------------------- caller

describe("dedupeFullText", () => {
	const fileRow = (path: string): Candidate => ({
		norm: 1,
		item: {
			kind: "file",
			source: "file",
			group: "files",
			id: `file:${path}`,
			title: path,
			aliases: [],
			path,
			resultKind: "note",
			mtime: 0,
			tile: { kind: "icon", icon: "file-text" },
		},
	});
	const textRow = (path: string): Candidate => ({
		norm: 1,
		item: {
			kind: "file",
			source: "fulltext",
			group: "fulltext",
			id: fullTextItemId(path),
			title: path,
			aliases: [],
			path,
			resultKind: "note",
			mtime: 0,
			tile: { kind: "icon", icon: "file-text" },
		},
	});
	const tagRow: Candidate = {
		norm: 1,
		item: {
			kind: "tag",
			source: "tag",
			group: "tags",
			id: "tag:x",
			title: "#x",
			aliases: [],
			tag: "x",
			count: 1,
			tile: { kind: "icon", icon: "hash" },
		},
	};

	it("drops the text row of a file the title match already returned", () => {
		const kept = dedupeFullText([fileRow("a.md"), textRow("a.md"), textRow("b.md")]);
		expect(kept.map(({ item }) => item.id)).toEqual([
			"file:a.md",
			fullTextItemId("b.md"),
		]);
	});

	it("keeps everything when no title matched", () => {
		const input = [textRow("a.md"), tagRow];
		expect(dedupeFullText(input)).toEqual(input);
	});

	it("never drops a row of another kind", () => {
		expect(dedupeFullText([fileRow("a.md"), tagRow])).toHaveLength(2);
	});
});

describe("fullTextPending", () => {
	it("is true only while a switched-on index is still building", () => {
		expect(fullTextPending(contextFor("x", { index: fakeIndex([hit("a.md")], { busy: true }) })))
			.toBe(true);
		expect(fullTextPending(contextFor("x", { index: fakeIndex([hit("a.md")]) }))).toBe(false);
		expect(fullTextPending(contextFor("x", { index: null }))).toBe(false);
		expect(
			fullTextPending(
				contextFor("x", {
					index: fakeIndex([hit("a.md")], { busy: true }),
					settings: { fullTextSearch: false },
				}),
			),
		).toBe(false);
	});
});
