// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { excerptAround, stripFrontmatter } from "../../src/ui/preview";

/** The preview's text handling — no rendering involved. */

describe("stripFrontmatter", () => {
	it("cuts LF frontmatter and counts the removed lines", () => {
		expect(stripFrontmatter("---\ntags: a\n---\nBody")).toEqual({ body: "Body", lines: 3 });
	});

	it("cuts CRLF frontmatter, as written by Windows editors", () => {
		expect(stripFrontmatter("---\r\ntags: a\r\n---\r\nBody")).toEqual({ body: "Body", lines: 3 });
	});

	it("leaves notes without frontmatter alone", () => {
		expect(stripFrontmatter("# Title\n---\nx")).toEqual({ body: "# Title\n---\nx", lines: 0 });
	});

	it("keeps the excerpt on the right line once the frontmatter is gone", () => {
		const filler = Array.from({ length: 200 }, (_, i) => `filler line ${i}`).join("\n");
		const note = `---\na: 1\nb: 2\n---\n${filler}\n## Target\n${filler}`;
		const targetLine = note.split("\n").indexOf("## Target");
		const { body, lines } = stripFrontmatter(note);
		expect(excerptAround(body, [], targetLine - lines)).toMatch(/^## Target/m);
	});
});
