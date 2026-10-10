import { describe, expect, it } from "vitest";
import { excerptAround, excerptFollowsWords, findMatchLine, snippetAt } from "../src/core/excerpt";
import { foldedWords } from "../src/core/normalize";

describe("findMatchLine", () => {
	const body = "# Title\n\nIntro line\n- [ ] Überblick über das Budget\nmore";

	it("finds the first line with a query word, folded like the index", () => {
		expect(findMatchLine(body, foldedWords("uberblick"))).toBe(3);
		expect(findMatchLine(body, foldedWords("budget"))).toBe(3);
		expect(findMatchLine(body, foldedWords("intro"))).toBe(2);
	});

	it("answers null for no match and for one-letter noise", () => {
		expect(findMatchLine(body, foldedWords("missing"))).toBeNull();
		expect(findMatchLine(body, ["a"])).toBeNull();
	});
});

describe("snippetAt", () => {
	it("drops list, task and heading markers", () => {
		expect(snippetAt("- [ ] Call the vendor", 0, ["vendor"])).toBe("Call the vendor");
		expect(snippetAt("## Budget review", 0, ["budget"])).toBe("Budget review");
		expect(snippetAt("> quoted words", 0, ["quoted"])).toBe("quoted words");
	});

	it("windows a long line around the match", () => {
		const long = `${"lorem ipsum ".repeat(20)}the needle sits here ${"dolor sit ".repeat(20)}`;
		const snippet = snippetAt(long, 0, ["needle"], 40);
		expect(snippet).toContain("needle");
		expect(snippet.startsWith("…")).toBe(true);
		expect(snippet.endsWith("…")).toBe(true);
		expect(snippet.length).toBeLessThanOrEqual(42);
	});
});

describe("excerptAround", () => {
	it("returns short bodies whole", () => {
		expect(excerptAround("short", ["x"])).toBe("short");
	});
});

describe("excerptFollowsWords", () => {
	const long = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");

	it("is false for a body that fits whole", () => {
		expect(excerptFollowsWords("short note")).toBe(false);
	});

	it("is true for a long body without a usable line", () => {
		expect(excerptFollowsWords(long)).toBe(true);
		expect(excerptFollowsWords(long, 0)).toBe(true);
		expect(excerptFollowsWords(long, 300)).toBe(true);
	});

	it("is false when the excerpt is centred on a line", () => {
		expect(excerptFollowsWords(long, 299)).toBe(false);
		expect(excerptFollowsWords(long, 1)).toBe(false);
	});
});
