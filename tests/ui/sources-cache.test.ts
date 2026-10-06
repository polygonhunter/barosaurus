// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { parseQuery } from "../../src/core/query";
import { EMPTY_CONTEXT } from "../../src/core/types";
import { filesSource, invalidateTitleTerms } from "../../src/sources/files";
import { headingsSource } from "../../src/sources/headings";

/**
 * The per-file caches of the title and heading sources.
 *
 * A rename keeps the TFile object AND its mtime. Caches validated by mtime
 * alone therefore went on answering to the old name: the renamed note was not
 * findable under its new one until its content changed.
 */

function note(path: string, mtime = 1): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.slice(path.lastIndexOf("/") + 1);
	file.basename = file.name.replace(/\.md$/, "");
	file.extension = "md";
	file.stat = { ctime: 0, mtime, size: 1 };
	return file;
}

function rename(file: TFile, path: string): void {
	file.path = path;
	file.name = path.slice(path.lastIndexOf("/") + 1);
	file.basename = file.name.replace(/\.md$/, "");
}

function appWith(files: TFile[], metadata: () => unknown = () => null): App {
	return {
		vault: {
			getFiles: () => files,
			getMarkdownFiles: () => files,
			getFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
		},
		workspace: { getLastOpenFiles: () => [] },
		metadataCache: { getFileCache: metadata },
	} as unknown as App;
}

function titles(app: App, text: string, source = filesSource): string[] {
	return source
		.getCandidates({ app, bar: EMPTY_CONTEXT, query: parseQuery(text), limit: 10 })
		.map((candidate) => candidate.item.title);
}

describe("title cache across renames", () => {
	it("finds a renamed note under its new name at once", () => {
		const file = note("Drafts/Kickoff.md");
		const app = appWith([file]);
		expect(titles(app, "kickoff")).toEqual(["Kickoff"]);

		rename(file, "Drafts/Launch plan.md");

		expect(titles(app, "launch")).toEqual(["Launch plan"]);
		expect(titles(app, "kickoff")).toEqual([]);
	});

	it("picks up new aliases once the metadata was re-parsed", () => {
		const file = note("People/Mira.md");
		let aliases: string[] = [];
		const app = appWith([file], () => ({ frontmatter: { aliases } }));
		expect(titles(app, "holt")).toEqual([]);

		aliases = ["Mira Holt"];
		invalidateTitleTerms(file);

		expect(titles(app, "holt")).toEqual(["Mira"]);
	});
});

describe("heading cache across renames", () => {
	it("labels headings with the note's new name", () => {
		const file = note("Old name.md");
		const app = appWith([file], () => ({
			headings: [{ heading: "Budget", level: 2, position: { start: { line: 3 } } }],
		}));
		const subtitle = (): string | undefined =>
			headingsSource
				.getCandidates({ app, bar: EMPTY_CONTEXT, query: parseQuery("budget"), limit: 10 })
				.map((candidate) => candidate.item.subtitle)[0];
		expect(subtitle()).toBe("Old name");

		rename(file, "New name.md");

		expect(subtitle()).toBe("New name");
	});
});
