// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { parseQuery } from "../../src/core/query";
import { EMPTY_CONTEXT, type OmniItem } from "../../src/core/types";
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
