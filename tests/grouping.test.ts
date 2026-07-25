import { describe, expect, it } from "vitest";
import { emptyRows, groupRows, headerFor, itemsOf } from "../src/core/grouping";
import { rankCandidates } from "../src/core/rank";
import { EMPTY_CONTEXT, GROUP_LABELS, isGroupHeader, type OmniRow } from "../src/core/types";
import {
	FIXTURE_ITEMS,
	fixtureCommand,
	fixtureContext,
	fixtureCreate,
	fixtureFile,
	fixtureSource,
	fixtureTag,
} from "./fixtures";

/** The shape of a row list, as a human reads it off the screen. */
function outline(rows: readonly OmniRow[]): string[] {
	return rows.map((row) => (isGroupHeader(row) ? `— ${row.label}` : `  ${row.title}`));
}

describe("groupRows", () => {
	it("orders groups by GROUP_ORDER, not by input order", () => {
		const { rows } = groupRows(FIXTURE_ITEMS);
		expect(outline(rows)).toEqual([
			`— ${GROUP_LABELS.commands}`,
			"  Toggle bold",
			"  Go back",
			`— ${GROUP_LABELS.files}`,
			"  alpha",
			"  beta",
			`— ${GROUP_LABELS.tags}`,
			"  #project",
			"  #design",
		]);
	});

	it("keeps the ranker's order inside a group", () => {
		const { items } = groupRows([fixtureFile("b"), fixtureFile("a"), fixtureFile("c")]);
		expect(items.map((item) => item.title)).toEqual(["b", "a", "c"]);
	});

	it("drops an empty group together with its header", () => {
		const { rows } = groupRows([fixtureCommand("app:go-back", "Go back")]);
		const labels = rows.filter(isGroupHeader).map((row) => row.label);
		expect(labels).toEqual([GROUP_LABELS.commands]);
		expect(labels).not.toContain(GROUP_LABELS.files);
		expect(labels).not.toContain(GROUP_LABELS.tags);
	});

	it("emits nothing at all for no items", () => {
		expect(groupRows([])).toEqual(emptyRows());
	});

	// ------------------------------------------------------------ the limit

	it("counts synthetic rows in the limit — headers included", () => {
		const grouped = groupRows(FIXTURE_ITEMS);
		expect(grouped.itemCount).toBe(6);
		// 6 items + 3 overlines. A limit of 6 would truncate the tags group away.
		expect(grouped.limit).toBe(9);
		expect(grouped.limit).toBe(grouped.rows.length);
	});

	it("counts a create-from-query row in the limit too", () => {
		const withCreate = [...FIXTURE_ITEMS, fixtureCreate("New note")];
		const grouped = groupRows(withCreate);
		expect(grouped.limit).toBe(11); // 7 items + 4 overlines
		expect(grouped.rows[grouped.rows.length - 1]).toMatchObject({ kind: "create" });
	});

	it("limit equals rows.length under every cap", () => {
		for (const options of [
			{},
			{ perGroupLimit: 1 },
			{ maxItems: 3 },
			{ headers: false },
			{ perGroupLimit: 1, maxItems: 2 },
		]) {
			const grouped = groupRows(FIXTURE_ITEMS, options);
			expect(grouped.limit, JSON.stringify(options)).toBe(grouped.rows.length);
			expect(grouped.items).toEqual(itemsOf(grouped.rows));
		}
	});

	// ------------------------------------------------------------- the caps

	it("caps items per group without losing the group", () => {
		const grouped = groupRows(FIXTURE_ITEMS, { perGroupLimit: 1 });
		expect(outline(grouped.rows)).toEqual([
			`— ${GROUP_LABELS.commands}`,
			"  Toggle bold",
			`— ${GROUP_LABELS.files}`,
			"  alpha",
			`— ${GROUP_LABELS.tags}`,
			"  #project",
		]);
		expect(grouped.limit).toBe(6);
	});

	it("drops the header of a group the overall budget never reaches", () => {
		const grouped = groupRows(FIXTURE_ITEMS, { maxItems: 3 });
		expect(outline(grouped.rows)).toEqual([
			`— ${GROUP_LABELS.commands}`,
			"  Toggle bold",
			"  Go back",
			`— ${GROUP_LABELS.files}`,
			"  alpha",
		]);
		// No dangling "Tags" label above nothing.
		expect(grouped.rows.filter(isGroupHeader).map((row) => row.label)).not.toContain(
			GROUP_LABELS.tags,
		);
	});

	it("omits every header when asked to", () => {
		const grouped = groupRows(FIXTURE_ITEMS, { headers: false });
		expect(grouped.rows.some(isGroupHeader)).toBe(false);
		expect(grouped.limit).toBe(grouped.itemCount);
	});

	it("drops groups missing from a narrowed order", () => {
		const grouped = groupRows(FIXTURE_ITEMS, { order: ["commands"] });
		expect(outline(grouped.rows)).toEqual([
			`— ${GROUP_LABELS.commands}`,
			"  Toggle bold",
			"  Go back",
		]);
	});

	it("labels headers from the label table", () => {
		expect(headerFor("openTabs")).toEqual({
			kind: "group-header",
			group: "openTabs",
			label: GROUP_LABELS.openTabs,
		});
	});
});

describe("source → rank → group", () => {
	it("mixes injected sources into one grouped list", () => {
		// The pipeline the modal runs, minus obsidian: every applicable source
		// contributes candidates, the ranker orders them, grouping lays them out.
		const sources = [
			fixtureSource("commands", [
				fixtureCommand("editor:toggle-bold", "Toggle bold"),
				fixtureCommand("app:go-back", "Go back"),
			]),
			fixtureSource("files", [fixtureFile("bold-ideas", "Bold ideas")]),
			// Ruled out by its own appliesTo — contributes nothing, and its group
			// must not appear.
			fixtureSource("tags", [fixtureTag("bold")], () => false),
		];

		const ctx = fixtureContext("bold");
		const candidates = sources
			.filter((source) => source.appliesTo(ctx))
			.flatMap((source) => source.getCandidates(ctx));
		const ranked = rankCandidates(candidates, ctx.query.text, EMPTY_CONTEXT);
		const grouped = groupRows(ranked.map((entry) => entry.item));

		expect(outline(grouped.rows)).toEqual([
			`— ${GROUP_LABELS.commands}`,
			"  Toggle bold",
			"  Go back",
			`— ${GROUP_LABELS.files}`,
			"  Bold ideas",
		]);
		expect(grouped.limit).toBe(5);
		expect(grouped.rows.filter(isGroupHeader).map((row) => row.label)).not.toContain(
			GROUP_LABELS.tags,
		);
	});
});
