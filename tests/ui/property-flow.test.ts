// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { createActionController } from "../../src/ui/action-panel";
import type { BarPage, BarSurface } from "../../src/ui/picker";

/** "Set status…" from the main list: the value step knows the note and the vault. */
describe("the set-property value step", () => {
	it("starts with the current value and lists the vault's existing ones", () => {
		const note = Object.assign(new TFile(), { path: "a.md", basename: "a", extension: "md" });
		const other = Object.assign(new TFile(), { path: "b.md", basename: "b", extension: "md" });
		const frontmatter: Record<string, Record<string, unknown>> = {
			"a.md": { status: "draft" },
			"b.md": { status: "done" },
		};
		const app = {
			vault: {
				getFileByPath: (path: string) => (path === "a.md" ? note : path === "b.md" ? other : null),
				getMarkdownFiles: () => [note, other],
			},
			metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: frontmatter[file.path] }) },
		} as unknown as App;

		const pushed: Array<{ page: BarPage; initialQuery: string }> = [];
		const values: string[] = [];
		const bar: BarSurface = {
			pushPage: (page, initialQuery = "") => pushed.push({ page, initialQuery }),
			popPage: () => false,
			commit: (value) => values.push(value),
			collected: () => [...values],
			refresh: () => undefined,
			close: () => undefined,
		};
		const controller = createActionController({ app, remember: () => undefined });
		expect(controller.startOnPath(bar, "set-property", "a.md", "status")).toBe(true);

		const last = pushed[pushed.length - 1];
		expect(last?.page.kind).toBe("propertyValue");
		expect(last?.initialQuery).toBe("draft");
		expect(last?.page.rows("").map((row) => row.title)).toEqual(["done", "draft"]);
		expect(last?.page.rows("rev").map((row) => row.subtitle)).toEqual(["New value"]);
	});
});
