// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { SearchResult } from "obsidian";
import { couldMatch, orderByMatch, type MatchFactory } from "../../src/sources/files";

/**
 * Obsidian's prepareSimpleSearch takes "space-separated words" and matches
 * each of them anywhere in the text. The harness's stand-in is a plain
 * substring search, so this models the real contract explicitly.
 */
const wordsAnyOrder: MatchFactory = (query) => (text) => {
	const words = query.split(" ").filter((word) => word.length > 0);
	if (!words.every((word) => text.includes(word))) return null;
	const result: SearchResult = { score: 0, matches: [] };
	return result;
};

describe("the prefilter never throws away what the search would match", () => {
	it("lets the words of a query through in any order", () => {
		expect(couldMatch("meeting notes 2024", "notes meeting")).toBe(true);
	});

	it("still rejects a word that is not there at all", () => {
		expect(couldMatch("meeting notes 2024", "notes budget")).toBe(false);
	});

	it("keeps the in-order subsequence check inside one word", () => {
		expect(couldMatch("meeting notes", "mtng")).toBe(true);
		expect(couldMatch("meeting notes", "gnitm")).toBe(false);
	});

	it("finds a title whose words were typed the other way round", () => {
		const entries = [
			{ value: "Meeting notes", terms: ["meeting notes"] },
			{ value: "Budget", terms: ["budget"] },
		];
		expect(orderByMatch(entries, "notes meeting", wordsAnyOrder, 10)).toEqual(["Meeting notes"]);
	});
});
