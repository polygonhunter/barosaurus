// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { excerptAround, PreviewPane, previewTargetFor, stripFrontmatter } from "../../src/ui/preview";
import type { OmniItem } from "../../src/core/types";

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

describe("previewTargetFor", () => {
	it("previews a full-text hit on a link as the note it sits in, at its line", () => {
		const hit = {
			id: "fulltext:Notes/a.md",
			kind: "file",
			source: "fulltext",
			group: "fulltext",
			title: "example.com",
			aliases: [],
			tile: { kind: "icon", icon: "link" },
			path: "Notes/a.md",
			resultKind: "link",
			mtime: 0,
			line: 7,
		} as OmniItem;
		expect(previewTargetFor(hit)).toEqual({ path: "Notes/a.md", kind: "note", line: 7 });
	});
});

describe("PreviewPane", () => {
	function pane(body = "body text") {
		const reads: string[] = [];
		const file = Object.assign(new TFile(), {
			path: "Notes/a.md",
			name: "a.md",
			basename: "a",
			extension: "md",
			stat: { ctime: 0, mtime: 5, size: 10 },
		});
		const app = {
			vault: {
				getFileByPath: (path: string) => (path === file.path ? file : null),
				cachedRead: (target: TFile) => {
					reads.push(target.path);
					return Promise.resolve(body);
				},
			},
		} as unknown as App;
		const el = document.body.createDiv();
		return { preview: new PreviewPane(app, el), reads, file, el };
	}

	it("does not re-read or re-render the note already on screen", async () => {
		const { preview, reads } = pane();
		await preview.showTarget({ path: "Notes/a.md", kind: "note" }, ["bo"]);
		await preview.showTarget({ path: "Notes/a.md", kind: "note" }, ["bod"]);
		expect(reads).toEqual(["Notes/a.md"]);
		preview.destroy();
	});

	it("moves a long note's excerpt to the new match when the query changes", async () => {
		const filler = Array.from({ length: 300 }, (_, i) => `filler line ${i}`).join("\n");
		const { preview, reads } = pane(`alpha start\n${filler}\nomega end`);
		await preview.showTarget({ path: "Notes/a.md", kind: "note" }, ["alpha"]);
		await preview.showTarget({ path: "Notes/a.md", kind: "note" }, ["omega"]);
		expect(reads).toEqual(["Notes/a.md", "Notes/a.md"]);
		preview.destroy();
	});

	it("renders only the target the selection came to rest on", async () => {
		const { preview, reads } = pane();
		const first = preview.showTarget({ path: "Notes/a.md", kind: "note", line: 1 });
		const second = preview.showTarget({ path: "Notes/a.md", kind: "note", line: 2 });
		await Promise.all([first, second]);
		expect(reads).toEqual(["Notes/a.md"]);
		preview.destroy();
	});

	it("marks a word with an umlaut or ß however it was typed", async () => {
		const { preview, el } = pane("Die Straße führt zum Überblick.");
		await preview.showTarget({ path: "Notes/a.md", kind: "note" }, ["strasse", "uberblick"]);
		const marks = Array.from(el.querySelectorAll("mark")).map((mark) => mark.textContent);
		expect(marks).toEqual(["Straße", "Überblick"]);
		preview.destroy();
	});

	it("keeps its column when reserved, even while empty", () => {
		const { preview, el } = pane();
		preview.setReserved(true);
		expect(el.hasClass("is-empty") && el.hasClass("is-reserved")).toBe(true);
		preview.destroy();
	});
});
