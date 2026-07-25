import { describe, expect, it } from "vitest";
import { containsPhrase, isEmptyQuery, matchesTag, parseQuery } from "../src/core/query";

describe("parseQuery — sigils", () => {
	it("scopes to commands on a bare '>'", () => {
		const parsed = parseQuery(">");
		expect(parsed.scope).toBe("command");
		expect(parsed.text).toBe("");
	});

	it("binds '>' without a following space", () => {
		const parsed = parseQuery(">bold");
		expect(parsed.scope).toBe("command");
		expect(parsed.text).toBe("bold");
	});

	it("tolerates a space after the sigil", () => {
		const parsed = parseQuery("> bold");
		expect(parsed.scope).toBe("command");
		expect(parsed.text).toBe("bold");
	});

	it("scopes to the active note's symbols on '@'", () => {
		const parsed = parseQuery("@intro");
		expect(parsed.scope).toBe("symbol");
		expect(parsed.text).toBe("intro");
	});

	it("scopes to a line on ':42' and returns immediately", () => {
		const parsed = parseQuery(":42");
		expect(parsed.scope).toBe("line");
		expect(parsed.line).toBe(42);
		expect(parsed.text).toBe("");
		expect(parsed.kind).toBeNull();
	});

	it("tolerates whitespace around the line number", () => {
		expect(parseQuery(": 42 ").line).toBe(42);
		expect(parseQuery(":  7").scope).toBe("line");
	});

	it("does not treat ':abc' as a line jump", () => {
		const parsed = parseQuery(":abc");
		expect(parsed.scope).toBe("all");
		expect(parsed.line).toBeNull();
		expect(parsed.text).toBe(":abc");
	});

	it("keeps the operator grammar after a sigil", () => {
		const parsed = parseQuery(">toggle -sidebar");
		expect(parsed.scope).toBe("command");
		expect(parsed.text).toBe("toggle");
		expect(parsed.excludes).toEqual(["sidebar"]);
	});
});

describe("isEmptyQuery — the launcher vs. a narrowed scope", () => {
	it("is FALSE for a bare '>' so it shows every command, not the launcher", () => {
		expect(isEmptyQuery(parseQuery(">"))).toBe(false);
	});

	it("is false for every other narrowed scope", () => {
		expect(isEmptyQuery(parseQuery("@"))).toBe(false);
		expect(isEmptyQuery(parseQuery(":12"))).toBe(false);
	});

	it("is true for an empty or whitespace-only query", () => {
		expect(isEmptyQuery(parseQuery(""))).toBe(true);
		expect(isEmptyQuery(parseQuery("   "))).toBe(true);
	});

	it("is false as soon as there is text or a tag", () => {
		expect(isEmptyQuery(parseQuery("b"))).toBe(false);
		expect(isEmptyQuery(parseQuery("#project"))).toBe(false);
	});
});

describe("parseQuery — kind operators", () => {
	it("parses n/f/i/l prefixes", () => {
		expect(parseQuery("n mira").kind).toBe("note");
		expect(parseQuery("f invoice").kind).toBe("file");
		expect(parseQuery("i whiteboard").kind).toBe("image");
		expect(parseQuery("l handbook").kind).toBe("link");
	});

	it("accepts d as file alias (merged document type)", () => {
		expect(parseQuery("d contract").kind).toBe("file");
	});

	it("is case-insensitive and strips the operator from text", () => {
		const parsed = parseQuery("N mira holt");
		expect(parsed.kind).toBe("note");
		expect(parsed.text).toBe("mira holt");
	});

	it("needs whitespace AND a non-empty remainder", () => {
		expect(parseQuery("note taking").kind).toBeNull();
		expect(parseQuery("if only").kind).toBeNull();
		expect(parseQuery("i").kind).toBeNull();
		expect(parseQuery("i ").kind).toBeNull();
		// …and the letter stays a search word rather than vanishing.
		expect(parseQuery("i ").text).toBe("i");
	});
});

describe("parseQuery — filters", () => {
	it("extracts #tags folded and with the '#' stripped", () => {
		const parsed = parseQuery("#Projekt mira");
		expect(parsed.tags).toEqual(["projekt"]);
		expect(parsed.text).toBe("mira");
	});

	it("folds umlauts inside a tag", () => {
		expect(parseQuery("#Übung").tags).toEqual(["ubung"]);
	});

	it("treats a bare '#' as text, not as a tag", () => {
		const parsed = parseQuery("#");
		expect(parsed.tags).toEqual([]);
		expect(parsed.text).toBe("#");
	});

	it("extracts -exclusions verbatim, unfolded", () => {
		const parsed = parseQuery("mira -Archiv");
		expect(parsed.excludes).toEqual(["Archiv"]);
		expect(parsed.text).toBe("mira");
	});

	it("keeps a lone hyphen as text", () => {
		expect(parseQuery("a - b").excludes).toEqual([]);
	});

	it("extracts p:/path:/pfad: prefixes", () => {
		expect(parseQuery("p:People/ mira").pathPrefix).toBe("People/");
		expect(parseQuery("path:Projects/ x").pathPrefix).toBe("Projects/");
		expect(parseQuery("pfad:Archiv/ x").pathPrefix).toBe("Archiv/");
		expect(parseQuery("PATH:Projects/ x").pathPrefix).toBe("Projects/");
	});

	it("parses mod: aliases (German and English)", () => {
		expect(parseQuery("mira mod:heute").modifiedWithinDays).toBe(1);
		expect(parseQuery("mira mod:today").modifiedWithinDays).toBe(1);
		expect(parseQuery("mira mod:woche").modifiedWithinDays).toBe(7);
		expect(parseQuery("mira mod:week").modifiedWithinDays).toBe(7);
		expect(parseQuery("mira mod:monat").modifiedWithinDays).toBe(31);
		expect(parseQuery("mira mod:month").modifiedWithinDays).toBe(31);
		expect(parseQuery("mira mod:jahr").modifiedWithinDays).toBe(366);
		expect(parseQuery("mira mod:year").modifiedWithinDays).toBe(366);
	});

	it("leaves an unknown mod: value as text", () => {
		const parsed = parseQuery("mod:gestern");
		expect(parsed.modifiedWithinDays).toBeNull();
		expect(parsed.text).toBe("mod:gestern");
	});

	it("extracts quoted phrases AND feeds their words into text", () => {
		const parsed = parseQuery('"design tokens" handbook');
		expect(parsed.phrases).toEqual(["design tokens"]);
		expect(parsed.text).toBe("handbook design tokens");
	});

	it("ignores an empty pair of quotes", () => {
		const parsed = parseQuery('"" handbook');
		expect(parsed.phrases).toEqual([]);
		expect(parsed.text).toBe("handbook");
	});

	it("combines a kind operator with every filter", () => {
		const parsed = parseQuery('n #design "exact words" -old p:Projects/ mira mod:woche');
		expect(parsed.kind).toBe("note");
		expect(parsed.tags).toEqual(["design"]);
		expect(parsed.phrases).toEqual(["exact words"]);
		expect(parsed.excludes).toEqual(["old"]);
		expect(parsed.pathPrefix).toBe("Projects/");
		expect(parsed.modifiedWithinDays).toBe(7);
		expect(parsed.text).toBe("mira exact words");
	});

	it("combines a sigil with a kind operator", () => {
		const parsed = parseQuery("@n intro");
		expect(parsed.scope).toBe("symbol");
		expect(parsed.kind).toBe("note");
		expect(parsed.text).toBe("intro");
	});
});

describe("containsPhrase", () => {
	it("matches verbatim after folding", () => {
		expect(containsPhrase("The Design Tokens are here", "design tokens")).toBe(true);
		expect(containsPhrase("Design of tokens", "design tokens")).toBe(false);
	});

	it("folds diacritics on both sides", () => {
		expect(containsPhrase("Müller Straße 5", "muller strasse")).toBe(true);
		expect(containsPhrase("muller strasse 5", "Müller Straße")).toBe(true);
	});

	it("is vacuously true for an empty phrase", () => {
		expect(containsPhrase("anything", "")).toBe(true);
		expect(containsPhrase("", "")).toBe(true);
	});
});

describe("matchesTag", () => {
	it("matches exact and nested tags", () => {
		expect(matchesTag(["project"], "project")).toBe(true);
		expect(matchesTag(["project/design"], "project")).toBe(true);
	});

	it("does not match a merely longer word", () => {
		expect(matchesTag(["projection"], "project")).toBe(false);
	});

	it("folds the stored tags and ignores a leading '#'", () => {
		expect(matchesTag(["#Projekt/Übung"], "projekt")).toBe(true);
	});

	it("is false for an empty tag list", () => {
		expect(matchesTag([], "project")).toBe(false);
	});
});
