// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import { parseQuery } from "../../src/core/query";
import { EMPTY_CONTEXT, type OmniItem } from "../../src/core/types";
import { invalidNameReason, resolvePrefixFolder } from "../../src/sources/create";
import { ghostSource, isAttachmentLinktext } from "../../src/sources/ghost";
import { choose, runAction, subpathOf } from "../../src/ui/execute";

/**
 * The executor and the sources it depends on, against a recording fake App.
 * Each case pins one bug that shipped: the wrong file created, the wrong
 * file bookmarked, a link that lost its heading.
 */

describe("ghost notes", () => {
	function ghostApp(unresolved: Record<string, Record<string, number>>) {
		const opened: Array<[string, string, unknown]> = [];
		const created: string[] = [];
		const app = {
			metadataCache: {
				unresolvedLinks: unresolved,
				getFirstLinkpathDest: () => null,
			},
			workspace: {
				openLinkText: (linktext: string, sourcePath: string, pane: unknown) => {
					opened.push([linktext, sourcePath, pane]);
					return Promise.resolve();
				},
			},
			vault: {
				create: (path: string) => {
					created.push(path);
					return Promise.resolve({ path });
				},
			},
		} as unknown as App;
		return { app, opened, created };
	}

	function ghosts(app: App, text: string): OmniItem[] {
		return ghostSource
			.getCandidates({ app, bar: EMPTY_CONTEXT, query: parseQuery(text), limit: 10 })
			.map((candidate) => candidate.item);
	}

	it("creates through openLinkText from the note that holds the link", async () => {
		const { app, opened, created } = ghostApp({ "Inbox/Today.md": { "Projects/Plan": 1 } });
		const [item] = ghosts(app, "plan");
		expect(item?.kind).toBe("ghost");
		await choose({ app, remember: () => undefined }, item as OmniItem, "tab");
		// "Projects/Plan" must stay a path, not become a note called "Projects Plan".
		expect(opened).toEqual([["Projects/Plan", "Inbox/Today.md", "tab"]]);
		expect(created).toEqual([]);
	});

	it("does not offer unresolved attachment embeds as notes to create", () => {
		const { app } = ghostApp({ "a.md": { "scan.png": 1, "Release 1.2": 1 } });
		expect(ghosts(app, "scan")).toEqual([]);
		expect(ghosts(app, "release").map((item) => item.title)).toEqual(["Release 1.2"]);
	});

	it("tells attachments from dotted note titles", () => {
		expect(isAttachmentLinktext("img/scan.PNG")).toBe(true);
		expect(isAttachmentLinktext("Board.canvas")).toBe(true);
		expect(isAttachmentLinktext("Release 1.2")).toBe(false);
		expect(isAttachmentLinktext(".hidden")).toBe(false);
	});
});

describe("bookmark", () => {
	it("bookmarks nothing when the file cannot be opened", async () => {
		const ran: string[] = [];
		const app = {
			commands: {
				commands: { "bookmarks:bookmark-current-file": { id: "bookmarks:bookmark-current-file", name: "Bookmark" } },
				executeCommandById: (id: string) => {
					ran.push(id);
					return true;
				},
			},
			vault: { getFileByPath: () => null },
		} as unknown as App;
		const item = {
			kind: "file",
			source: "file",
			group: "files",
			id: "file:gone.md",
			title: "gone",
			aliases: [],
			tile: { kind: "icon", icon: "file" },
			path: "gone.md",
			resultKind: "note",
		} as unknown as OmniItem;
		await runAction({ app, remember: () => undefined }, "bookmark", item);
		expect(ran).toEqual([]);
	});
});

describe("links to headings and blocks keep their subpath", () => {
	function linkApp() {
		const inserted: string[] = [];
		const file = new TFile();
		file.path = "Projects/Plan.md";
		const app = {
			vault: { getFileByPath: (path: string) => (path === file.path ? file : null) },
			workspace: {
				activeEditor: { editor: { replaceSelection: (text: string) => inserted.push(text) } },
				getActiveFile: () => null,
			},
			fileManager: {
				generateMarkdownLink: (target: TFile, _source: string, subpath?: string) =>
					`[[${target.path}${subpath ?? ""}]]`,
			},
		} as unknown as App;
		return { app, inserted };
	}

	const heading = {
		kind: "heading",
		source: "heading",
		group: "structure",
		id: "heading:Projects/Plan.md:4",
		title: "Budget: Q3 [draft]",
		aliases: [],
		tile: { kind: "heading", level: 2 },
		path: "Projects/Plan.md",
		level: 2,
		line: 4,
	} as unknown as OmniItem;

	it("inserts a heading link with #heading", async () => {
		const { app, inserted } = linkApp();
		await runAction({ app, remember: () => undefined }, "insert-link", heading);
		expect(inserted).toEqual(["[[Projects/Plan.md#Budget Q3 draft]]"]);
	});

	it("builds #^id for blocks and nothing for whole files", () => {
		expect(subpathOf({ ...heading, kind: "block", blockId: "abc123" } as unknown as OmniItem)).toBe(
			"#^abc123",
		);
		expect(
			subpathOf({ kind: "file", path: "a.md", title: "a" } as unknown as OmniItem),
		).toBeUndefined();
	});
});

describe("names and folders typed into the bar", () => {
	it("refuses rename targets Obsidian cannot use, with a reason", () => {
		expect(invalidNameReason("Plan: Q3")).toContain("“:”");
		expect(invalidNameReason("a/b")).toContain("“/”");
		expect(invalidNameReason(".hidden")).toContain("dot");
		expect(invalidNameReason("Draft.")).toContain("end with");
		expect(invalidNameReason("Draft ")).toContain("end with");
		expect(invalidNameReason("Release 1.2")).toBeNull();
		// Twice in a row: a /g regex would answer differently the second time.
		expect(invalidNameReason("x#y")).not.toBeNull();
		expect(invalidNameReason("x#y")).not.toBeNull();
	});

	it("resolves a p: prefix to the folder it actually means", () => {
		const folder = (path: string) => Object.assign(new TFolder(), { path });
		const app = {
			vault: {
				getAllLoadedFiles: () => [
					folder("/"),
					folder("Projects"),
					folder("Projects/Archive"),
					folder("Personal"),
				],
			},
		} as unknown as App;
		expect(resolvePrefixFolder(app, "Personal")).toBe("Personal");
		expect(resolvePrefixFolder(app, "projects")).toBe("Projects");
		expect(resolvePrefixFolder(app, "proj")).toBe("Projects");
		expect(resolvePrefixFolder(app, "projects/arch")).toBe("Projects/Archive");
		expect(resolvePrefixFolder(app, "nowhere")).toBeNull();
	});
});

describe("the delete confirmation", () => {
	function deleteApp() {
		const trashed: string[] = [];
		const file = new TFile();
		file.path = "Inbox/Old.md";
		file.name = "Old.md";
		const app = {
			vault: { getAbstractFileByPath: (path: string) => (path === file.path ? file : null) },
			fileManager: {
				trashFile: (target: TFile) => {
					trashed.push(target.path);
					return Promise.resolve();
				},
			},
		} as unknown as App;
		const item = {
			kind: "file",
			source: "file",
			group: "files",
			id: "file:Inbox/Old.md",
			title: "Old",
			aliases: [],
			tile: { kind: "icon", icon: "file" },
			path: file.path,
			resultKind: "note",
		} as unknown as OmniItem;
		return { app, item, trashed };
	}

	/** The open confirmation dialog's scope, found through the DOM it built. */
	function dialogButtons(): HTMLButtonElement[] {
		return Array.from(document.querySelectorAll<HTMLButtonElement>(".barosaurus-confirm button"));
	}

	it("keeps the bar open when the user cancels", async () => {
		const { app, item, trashed } = deleteApp();
		const outcome = runAction({ app, remember: () => undefined }, "delete", item);
		await new Promise((resolve) => setTimeout(resolve, 0));
		dialogButtons().find((button) => button.textContent === "Cancel")?.click();
		expect(await outcome).toBe("stay");
		expect(trashed).toEqual([]);
	});

	it("focuses the delete button so Enter does what the ring shows", async () => {
		const { app, item, trashed } = deleteApp();
		const outcome = runAction({ app, remember: () => undefined }, "delete", item);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const focused = document.activeElement as HTMLButtonElement | null;
		expect(focused?.textContent).toBe("Delete");
		focused?.click();
		expect(await outcome).toBe("close");
		expect(trashed).toEqual(["Inbox/Old.md"]);
	});
});

describe("opening a full-text hit", () => {
	it("opens the note at the line that matched", async () => {
		const opened: unknown[] = [];
		const file = Object.assign(new TFile(), { path: "notes/long.md" });
		const app = {
			vault: {
				getFileByPath: () => file,
				cachedRead: () => Promise.resolve("intro\n\nfiller\nthe budget figures\n"),
			},
			workspace: {
				getLeaf: () => ({
					openFile: (_file: TFile, state: unknown) => {
						opened.push(state);
						return Promise.resolve();
					},
				}),
			},
		} as unknown as App;
		const item = {
			kind: "file",
			source: "fulltext",
			group: "fulltext",
			id: "fulltext:notes/long.md",
			title: "long",
			aliases: [],
			tile: { kind: "icon", icon: "file-text" },
			path: "notes/long.md",
			resultKind: "note",
			mtime: 0,
			matchWords: ["budget"],
		} as unknown as OmniItem;
		await choose({ app, remember: () => undefined }, item, false);
		expect(opened).toEqual([{ eState: { line: 3 } }]);
	});
});
