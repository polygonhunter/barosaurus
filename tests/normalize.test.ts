import { describe, expect, it } from "vitest";
import { acronym, fold, foldedWords, processTerm } from "../src/core/normalize";

describe("fold", () => {
	it("lowercases and trims", () => {
		expect(fold("  Toggle Bold  ")).toBe("toggle bold");
	});

	it("folds German umlauts and ß", () => {
		expect(fold("Müller")).toBe("muller");
		expect(fold("Straße")).toBe("strasse");
		expect(fold("Ärger Öl Übung")).toBe("arger ol ubung");
	});

	it("folds other diacritics", () => {
		expect(fold("Café Zoë")).toBe("cafe zoe");
	});

	it("turns punctuation into a SPACE, not into nothing", () => {
		// The whole word-prefix tier depends on this: "mi-ho" has to stay two
		// words, and a nested tag has to become two words as well.
		expect(fold("mi-ho")).toBe("mi ho");
		expect(fold("project/design")).toBe("project design");
		expect(fold("Meeting (2026-07-16)!")).toBe("meeting 2026 07 16");
	});

	it("keeps digits", () => {
		expect(fold("Heading 2")).toBe("heading 2");
		expect(fold("H2 — 2026")).toBe("h2 2026");
	});

	it("collapses whitespace", () => {
		expect(fold("a\t b\n  c")).toBe("a b c");
	});

	it("returns the empty string for empty and punctuation-only input", () => {
		expect(fold("")).toBe("");
		expect(fold("   ")).toBe("");
		expect(fold("…!!!")).toBe("");
	});
});

describe("processTerm", () => {
	it("returns folded terms", () => {
		expect(processTerm("Müller")).toBe("muller");
		expect(processTerm("  Straße  ")).toBe("strasse");
	});

	it("returns null — never the empty string — for terms that fold away", () => {
		// MiniSearch drops a term on null; "" would be indexed as a real term.
		expect(processTerm("")).toBeNull();
		expect(processTerm("   ")).toBeNull();
		expect(processTerm("!!!")).toBeNull();
	});
});

describe("foldedWords", () => {
	it("splits folded text into words", () => {
		expect(foldedWords("Toggle  Bold")).toEqual(["toggle", "bold"]);
		expect(foldedWords("mi-ho")).toEqual(["mi", "ho"]);
	});

	it("returns [] rather than [\"\"] for empty input", () => {
		expect(foldedWords("")).toEqual([]);
		expect(foldedWords("   ")).toEqual([]);
		expect(foldedWords(" … ")).toEqual([]);
	});
});

describe("acronym", () => {
	it("takes the initial of every folded word", () => {
		expect(acronym("Toggle bold text")).toBe("tbt");
		expect(acronym("Table of contents")).toBe("toc");
	});

	it("keeps digits as their own initial", () => {
		expect(acronym("Heading 2")).toBe("h2");
	});

	it("folds before taking initials", () => {
		expect(acronym("Übersicht Öffnen")).toBe("uo");
		expect(acronym("mi-ho")).toBe("mh");
	});

	it("is one character for a single word and empty for no words", () => {
		expect(acronym("Bold")).toBe("b");
		expect(acronym("")).toBe("");
		expect(acronym("!!!")).toBe("");
	});
});
