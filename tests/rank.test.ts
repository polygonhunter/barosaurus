import { describe, expect, it } from "vitest";
import { fold, foldedWords } from "../src/core/normalize";
import { normalizeByRank, rankCandidates, tierOf } from "../src/core/rank";
import type { Candidate, OmniItem } from "../src/core/types";
import {
	EMPTY_CONTEXT,
	TIER_ACRONYM,
	TIER_CONTIGUOUS,
	TIER_EXACT,
	TIER_FUZZY,
	TIER_PREFIX,
} from "../src/core/types";

type CommandItem = Extract<OmniItem, { kind: "command" }>;
type FileItem = Extract<OmniItem, { kind: "file" }>;

function command(overrides: Partial<CommandItem> & { id: string }): CommandItem {
	return {
		kind: "command",
		source: "command",
		group: "commands",
		title: overrides.id,
		aliases: [],
		tile: { kind: "icon", icon: "zap" },
		commandId: `test:${overrides.id}`,
		...overrides,
	};
}

function file(overrides: Partial<FileItem> & { id: string }): FileItem {
	return {
		kind: "file",
		source: "file",
		group: "files",
		title: overrides.id,
		aliases: [],
		tile: { kind: "icon", icon: "file" },
		path: `${overrides.id}.md`,
		resultKind: "note",
		mtime: 0,
		...overrides,
	};
}

const candidate = (item: OmniItem, norm: number): Candidate => ({ item, norm });

/** tierOf takes the pre-folded query the ranker computes once per keystroke. */
const tierFor = (item: OmniItem, query: string): number =>
	tierOf(item, fold(query), foldedWords(query));

const ids = (ranked: ReadonlyArray<{ item: OmniItem }>): string[] =>
	ranked.map((entry) => entry.item.id);

describe("tierOf — match quality ordering", () => {
	const toggleBold = command({ id: "toggle-bold", title: "Toggle bold" });

	it("orders exact before prefix before contiguous before acronym before fuzzy", () => {
		expect(TIER_EXACT).toBeLessThan(TIER_PREFIX);
		expect(TIER_PREFIX).toBeLessThan(TIER_CONTIGUOUS);
		expect(TIER_CONTIGUOUS).toBeLessThan(TIER_ACRONYM);
		expect(TIER_ACRONYM).toBeLessThan(TIER_FUZZY);
	});

	it("assigns every tier from the same title", () => {
		expect(tierFor(toggleBold, "toggle bold")).toBe(TIER_EXACT);
		expect(tierFor(toggleBold, "toggle")).toBe(TIER_PREFIX);
		expect(tierFor(toggleBold, "bold")).toBe(TIER_CONTIGUOUS);
		expect(tierFor(toggleBold, "tb")).toBe(TIER_ACRONYM);
		expect(tierFor(toggleBold, "xyz")).toBe(TIER_FUZZY);
	});

	it("folds the title, so an umlaut query still reaches tier 0", () => {
		const item = command({ id: "u", title: "Übersicht öffnen" });
		expect(tierFor(item, "ubersicht offnen")).toBe(TIER_EXACT);
		expect(tierFor(command({ id: "s", title: "Straße" }), "strasse")).toBe(TIER_EXACT);
	});

	it("counts aliases at EVERY tier, not just as a fallback", () => {
		const bold = command({ id: "bold", title: "Toggle bold", aliases: ["Fett"] });
		expect(tierFor(bold, "fett")).toBe(TIER_EXACT);
		expect(tierFor(bold, "fet")).toBe(TIER_PREFIX);
		expect(tierFor(bold, "ett")).toBe(TIER_CONTIGUOUS);

		const heading = command({ id: "h", title: "Bold", aliases: ["Fett machen"] });
		expect(tierFor(heading, "fm")).toBe(TIER_ACRONYM);
	});

	it("prefix-matches multi-word queries word by word, in order", () => {
		expect(tierFor(toggleBold, "to bo")).toBe(TIER_PREFIX);
		expect(tierFor(toggleBold, "t b")).toBe(TIER_PREFIX);
	});

	it("requires the query words to be in order", () => {
		expect(tierFor(toggleBold, "bo to")).toBe(TIER_FUZZY);
	});

	it("needs at least two query words for the word-prefix rule", () => {
		// "tobo" is neither a prefix nor a substring, and the single-word query
		// never enters the word-by-word branch.
		expect(tierFor(toggleBold, "tobo")).toBe(TIER_FUZZY);
	});

	it("matches acronyms including digits", () => {
		const heading2 = command({ id: "h2", title: "Heading 2" });
		expect(tierFor(heading2, "h2")).toBe(TIER_ACRONYM);
		expect(tierFor(command({ id: "t", title: "Toggle bold text" }), "tbt")).toBe(TIER_ACRONYM);
	});

	it("never lets a single letter match as an acronym", () => {
		// An acronym needs initials.length > 1, so one-word titles never qualify
		// and a one-letter query only ever wins on a stronger tier.
		const items = [
			command({ id: "a", title: "Bold" }),
			command({ id: "b", title: "Toggle bold" }),
			command({ id: "c", title: "Heading 2" }),
		];
		for (const item of items) {
			for (const letter of ["a", "b", "h", "t", "z"]) {
				expect(tierFor(item, letter), `${item.title} vs "${letter}"`).not.toBe(TIER_ACRONYM);
			}
		}
		expect(tierFor(command({ id: "x", title: "Bold" }), "b")).toBe(TIER_PREFIX);
	});

	it("puts everything in the fuzzy tier for an empty query", () => {
		expect(tierFor(toggleBold, "")).toBe(TIER_FUZZY);
		expect(tierFor(toggleBold, "   ")).toBe(TIER_FUZZY);
		expect(tierFor(command({ id: "empty", title: "" }), "")).toBe(TIER_FUZZY);
	});
});

describe("rankCandidates — the tier dominates the score", () => {
	it("puts a tier-0 item with no score above a tier-4 item with every boost", () => {
		const candidates = [
			candidate(command({ id: "zebra", title: "Zebra" }), 1),
			candidate(command({ id: "bold", title: "Bold" }), 0),
		];
		const ranked = rankCandidates(candidates, "bold", EMPTY_CONTEXT, {
			frecency: { zebra: 1 },
			pinned: new Set(["zebra"]),
			contextBoost: { zebra: 1 },
		});
		expect(ids(ranked)).toEqual(["bold", "zebra"]);
		expect(ranked[0]?.tier).toBe(TIER_EXACT);
		expect(ranked[0]?.score).toBe(0);
	});

	it("orders by score inside a tier", () => {
		const candidates = [
			candidate(command({ id: "weak", title: "Zebra one" }), 0.2),
			candidate(command({ id: "strong", title: "Zebra two" }), 0.9),
		];
		expect(ids(rankCandidates(candidates, "", EMPTY_CONTEXT))).toEqual(["strong", "weak"]);
	});

	it("adds the pin boost", () => {
		const candidates = [
			candidate(command({ id: "a", title: "Alpha" }), 0.5),
			candidate(command({ id: "b", title: "Beta" }), 0.5),
		];
		expect(ids(rankCandidates(candidates, "", EMPTY_CONTEXT))).toEqual(["a", "b"]);
		const pinned = rankCandidates(candidates, "", EMPTY_CONTEXT, { pinned: new Set(["b"]) });
		expect(ids(pinned)).toEqual(["b", "a"]);
	});

	it("adds the frecency boost", () => {
		const candidates = [
			candidate(command({ id: "a", title: "Alpha" }), 0.5),
			candidate(command({ id: "b", title: "Beta" }), 0.5),
		];
		const ranked = rankCandidates(candidates, "", EMPTY_CONTEXT, { frecency: { b: 0.4 } });
		expect(ids(ranked)).toEqual(["b", "a"]);
		expect(ranked[0]?.score).toBeCloseTo(0.9);
	});

	it("adds the context boost", () => {
		const candidates = [
			candidate(command({ id: "a", title: "Alpha" }), 0.5),
			candidate(command({ id: "b", title: "Beta" }), 0.5),
		];
		const ranked = rankCandidates(candidates, "", EMPTY_CONTEXT, { contextBoost: { b: 0.6 } });
		expect(ids(ranked)).toEqual(["b", "a"]);
	});

	it("weights the source once tiers tie", () => {
		const candidates = [
			candidate(file({ id: "a", title: "Alpha" }), 1),
			candidate(command({ id: "z", title: "Zulu" }), 1),
		];
		// Command (1.0) outweighs file (0.9) even though the id order says otherwise.
		expect(ids(rankCandidates(candidates, "", EMPTY_CONTEXT))).toEqual(["z", "a"]);
	});

	it("breaks ties by the shorter title inside a title tier", () => {
		const candidates = [
			candidate(command({ id: "long", title: "Bold text everywhere" }), 0.5),
			candidate(command({ id: "short", title: "Bold" }), 0.5),
		];
		// Alphabetically "long" would win; the title length decides first.
		expect(ids(rankCandidates(candidates, "bo", EMPTY_CONTEXT))).toEqual(["short", "long"]);
	});

	it("falls back to the id so the order is deterministic", () => {
		const candidates = [
			candidate(command({ id: "b", title: "A very long title indeed" }), 0.5),
			candidate(command({ id: "a", title: "Q" }), 0.5),
		];
		// Fuzzy tier: title length is NOT consulted, the id is.
		expect(ids(rankCandidates(candidates, "", EMPTY_CONTEXT))).toEqual(["a", "b"]);
	});

	it("never filters — a candidate matching nothing still comes back, just last", () => {
		const candidates = [
			candidate(command({ id: "nothing", title: "Xylophone" }), 1),
			candidate(command({ id: "bold", title: "Bold" }), 0),
			candidate(command({ id: "also-nothing", title: "Kettle" }), 1),
		];
		const ranked = rankCandidates(candidates, "bold", EMPTY_CONTEXT);
		expect(ranked).toHaveLength(3);
		expect(ids(ranked)).toEqual(["bold", "also-nothing", "nothing"]);
		expect(ranked[1]?.tier).toBe(TIER_FUZZY);
	});

	it("does not mutate the input array", () => {
		const candidates = [
			candidate(command({ id: "zebra", title: "Zebra" }), 1),
			candidate(command({ id: "bold", title: "Bold" }), 0),
		];
		const before = candidates.map((entry) => entry.item.id);
		rankCandidates(candidates, "bold", EMPTY_CONTEXT);
		expect(candidates.map((entry) => entry.item.id)).toEqual(before);
	});

	it("returns an empty list for no candidates", () => {
		expect(rankCandidates([], "bold", EMPTY_CONTEXT)).toEqual([]);
	});
});

describe("normalizeByRank", () => {
	it("gives a single element the full score", () => {
		expect(normalizeByRank(["only"])).toEqual([{ value: "only", norm: 1 }]);
	});

	it("returns nothing for an empty list", () => {
		expect(normalizeByRank([])).toEqual([]);
	});

	it("starts at 1 and steps down evenly", () => {
		expect(normalizeByRank(["a", "b", "c", "d"]).map((entry) => entry.norm)).toEqual([
			1, 0.75, 0.5, 0.25,
		]);
	});

	it("stays strictly decreasing inside (0,1]", () => {
		const normalized = normalizeByRank(Array.from({ length: 10 }, (_, i) => i));
		for (const [i, entry] of normalized.entries()) {
			expect(entry.norm, `norm ${i} > 0`).toBeGreaterThan(0);
			expect(entry.norm, `norm ${i} <= 1`).toBeLessThanOrEqual(1);
			const previous = normalized[i - 1];
			if (previous) expect(entry.norm, `norm ${i} < norm ${i - 1}`).toBeLessThan(previous.norm);
		}
	});

	it("keeps the values and their order", () => {
		expect(normalizeByRank(["x", "y"]).map((entry) => entry.value)).toEqual(["x", "y"]);
	});
});
