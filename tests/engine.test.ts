import { describe, expect, it } from "vitest";
import { SearchEngine, TITLE_FIELDS } from "../src/core/engine";
import { DEFAULT_WEIGHTS, kindForExtension, type IndexedDoc } from "../src/core/index-types";

function doc(overrides: Partial<IndexedDoc> & { id: string }): IndexedDoc {
	return {
		kind: "note",
		basename: "",
		aliases: "",
		headings: "",
		tags: "",
		body: "",
		extractedText: "",
		url: "",
		path: overrides.id,
		mtime: 0,
		aliasList: [],
		tagList: [],
		...overrides,
	};
}

function makeEngine(): SearchEngine {
	return new SearchEngine(DEFAULT_WEIGHTS);
}

describe("SearchEngine", () => {
	it("finds docs by body content", () => {
		const engine = makeEngine();
		engine.upsert(doc({ id: "a.md", basename: "a", body: "the quick brown fox" }));
		const hits = engine.search("quick fox");
		expect(hits.map((h) => h.id)).toEqual(["a.md"]);
	});

	it("boosts basename matches above body mentions", () => {
		const engine = makeEngine();
		engine.upsert(doc({ id: "People/Mira Holt.md", basename: "Mira Holt" }));
		engine.upsert(
			doc({
				id: "log.md",
				basename: "log",
				body: "Talked to Mira Holt about Mira Holt's plans. Mira Holt agreed.",
			}),
		);
		const hits = engine.search("Mira Holt");
		expect(hits[0]?.id).toBe("People/Mira Holt.md");
	});

	it("matches umlaut queries against folded titles and vice versa", () => {
		const engine = makeEngine();
		engine.upsert(doc({ id: "m.md", basename: "Max Müller" }));
		expect(engine.search("müller")[0]?.id).toBe("m.md");
		expect(engine.search("muller")[0]?.id).toBe("m.md");
	});

	it("matches aliases", () => {
		const engine = makeEngine();
		engine.upsert(
			doc({ id: "p.md", basename: "Mira Holt", aliases: "Miri", aliasList: ["Miri"] }),
		);
		expect(engine.search("Miri")[0]?.id).toBe("p.md");
	});

	it("upserts without duplicating and removes cleanly", () => {
		const engine = makeEngine();
		engine.upsert(doc({ id: "a.md", basename: "alpha" }));
		engine.upsert(doc({ id: "a.md", basename: "alpha renamed" }));
		expect(engine.size).toBe(1);
		expect(engine.search("renamed")).toHaveLength(1);
		expect(engine.search("alpha")).toHaveLength(1);

		engine.remove("a.md");
		expect(engine.search("alpha")).toHaveLength(0);
		engine.remove("a.md"); // no-op, must not throw
		expect(engine.has("a.md")).toBe(false);
	});

	it("returns stored fields on hits", () => {
		const engine = makeEngine();
		engine.upsert(
			doc({ id: "x.md", basename: "X", path: "sub/x.md", mtime: 42, aliasList: ["y"] }),
		);
		const hit = engine.search("x")[0];
		expect(hit?.path).toBe("sub/x.md");
		expect(hit?.mtime).toBe(42);
		expect(hit?.kind).toBe("note");
		expect(hit?.aliasList).toEqual(["y"]);
	});

	it("carries link docs with their url and line", () => {
		const engine = makeEngine();
		engine.upsert(
			doc({
				id: "note.md::L12",
				kind: "link",
				basename: "Obsidian help",
				url: "https://help.obsidian.md",
				path: "note.md",
				line: 3,
			}),
		);
		const hit = engine.search("obsidian help")[0];
		expect(hit?.kind).toBe("link");
		expect(hit?.url).toBe("https://help.obsidian.md");
		expect(hit?.line).toBe(3);
	});

	it("drops hits matching an excluded term", () => {
		const engine = makeEngine();
		engine.upsert(doc({ id: "a.md", basename: "release notes", body: "draft" }));
		engine.upsert(doc({ id: "b.md", basename: "release notes", body: "final" }));
		expect(engine.searchWithExcludes("release", ["draft"]).map((h) => h.id)).toEqual(["b.md"]);
		// no excludes → plain search
		expect(engine.searchWithExcludes("release", [])).toHaveLength(2);
	});

	it("can restrict a search to title fields", () => {
		const engine = makeEngine();
		engine.upsert(doc({ id: "title.md", basename: "budget" }));
		engine.upsert(doc({ id: "body.md", basename: "misc", body: "budget planning" }));
		const hits = engine.search("budget", { fields: [...TITLE_FIELDS] });
		expect(hits.map((h) => h.id)).toEqual(["title.md"]);
	});

	it("round-trips through toJSON/load", () => {
		const engine = makeEngine();
		engine.upsert(doc({ id: "a.md", basename: "Mira Holt" }));
		engine.upsert(doc({ id: "b.md", basename: "b", body: "unrelated text" }));
		const json = engine.toJSON();

		const restored = makeEngine();
		restored.load(json);
		expect(restored.size).toBe(2);
		expect(restored.search("mira")[0]?.id).toBe("a.md");
		// the restored index must stay writable
		restored.upsert(doc({ id: "c.md", basename: "Mira Bay" }));
		expect(restored.search("mira")).toHaveLength(2);
	});

	it("clears everything", () => {
		const engine = makeEngine();
		engine.upsert(doc({ id: "a.md", basename: "a" }));
		engine.clear();
		expect(engine.size).toBe(0);
		expect(engine.search("a")).toEqual([]);
	});

	it("returns [] for empty queries", () => {
		const engine = makeEngine();
		engine.upsert(doc({ id: "a.md", basename: "a" }));
		expect(engine.search("   ")).toEqual([]);
		expect(engine.searchWithExcludes("", ["x"])).toEqual([]);
	});
});

describe("kindForExtension", () => {
	it("maps markdown to notes", () => {
		expect(kindForExtension("md")).toBe("note");
		expect(kindForExtension("MD")).toBe("note");
	});

	it("maps renderable pictures to images", () => {
		expect(kindForExtension("png")).toBe("image");
		expect(kindForExtension("JPEG")).toBe("image");
		expect(kindForExtension("svg")).toBe("image");
	});

	it("maps everything else to files", () => {
		expect(kindForExtension("pdf")).toBe("file");
		expect(kindForExtension("canvas")).toBe("file");
		expect(kindForExtension("")).toBe("file");
	});
});
