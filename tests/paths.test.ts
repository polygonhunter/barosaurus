import { describe, expect, it } from "vitest";
import { folderOf, isPathExcluded, normalizeExcludedFolders, pathExcluder } from "../src/core/paths";

describe("isPathExcluded", () => {
	it("matches files inside the folder", () => {
		expect(isPathExcluded("templates/daily.md", ["templates"])).toBe(true);
		expect(isPathExcluded("templates/sub/x.md", ["templates"])).toBe(true);
	});

	it("respects folder boundaries", () => {
		expect(isPathExcluded("templates2.md", ["templates"])).toBe(false);
		expect(isPathExcluded("templates-old/x.md", ["templates"])).toBe(false);
	});

	it("tolerates trailing slashes from hand-typed entries", () => {
		expect(isPathExcluded("archive/2020.md", ["archive/"])).toBe(true);
		expect(isPathExcluded("archive/2020.md", ["archive///"])).toBe(true);
	});

	it("matches the folder path itself", () => {
		expect(isPathExcluded("archive", ["archive"])).toBe(true);
	});

	it("ignores empty entries", () => {
		expect(isPathExcluded("anything.md", ["", "/"])).toBe(false);
	});

	it("matches when any one of several folders applies", () => {
		expect(isPathExcluded("archive/x.md", ["templates", "archive"])).toBe(true);
		expect(isPathExcluded("notes/x.md", ["templates", "archive"])).toBe(false);
	});

	it("handles nested folder exclusions", () => {
		expect(isPathExcluded("projects/archive/x.md", ["projects/archive"])).toBe(true);
		expect(isPathExcluded("projects/active/x.md", ["projects/archive"])).toBe(false);
	});

	it("excludes nothing when the list is empty", () => {
		expect(isPathExcluded("templates/daily.md", [])).toBe(false);
	});
});

describe("normalizeExcludedFolders", () => {
	it("trims trailing slashes and drops empty rows", () => {
		expect(normalizeExcludedFolders(["templates/", "", "  ", "archive///", "/"])).toEqual([
			"templates",
			"  ",
			"archive",
		]);
	});
});

describe("pathExcluder", () => {
	it("answers exactly like isPathExcluded", () => {
		const folders = ["templates", "projects/archive/"];
		const excluded = pathExcluder(folders);
		for (const path of [
			"templates/daily.md",
			"templates2.md",
			"templates-old/x.md",
			"projects/archive/x.md",
			"projects/active/x.md",
			"templates",
			"notes/deep/x.md",
		]) {
			expect(excluded(path), path).toBe(isPathExcluded(path, folders));
		}
	});

	it("is a constant false when nothing is excluded", () => {
		// The common case must cost nothing — a source builds this once per
		// keystroke and calls it once per file in the vault.
		const excluded = pathExcluder(["", "/"]);
		expect(excluded("templates/daily.md")).toBe(false);
		expect(excluded("anything")).toBe(false);
	});
});

describe("folderOf", () => {
	it("returns the parent folder", () => {
		expect(folderOf("projects/notes/a.md")).toBe("projects/notes");
	});

	it("is undefined at the vault root", () => {
		expect(folderOf("a.md")).toBeUndefined();
		// A leading slash leaves nothing usable in front of it either.
		expect(folderOf("/a.md")).toBeUndefined();
	});
});
