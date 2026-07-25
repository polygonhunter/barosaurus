import { describe, expect, it } from "vitest";
import {
	actionsFor,
	ALL_AVAILABLE,
	filterAvailable,
	NONE_AVAILABLE,
	type PluginCapabilities,
} from "../src/core/availability";
import type { ActionDef, BarContext, OmniItem } from "../src/core/types";
import { EMPTY_CONTEXT } from "../src/core/types";

type CommandItem = Extract<OmniItem, { kind: "command" }>;
type FileItem = Extract<OmniItem, { kind: "file" }>;

function command(overrides: Partial<CommandItem> & { id: string }): CommandItem {
	return {
		kind: "command",
		source: "command",
		group: "commands",
		title: overrides.id,
		aliases: [],
		tile: { kind: "icon", icon: "zap" },
		commandId: `test:${overrides.id}`,
		...overrides,
	};
}

function file(overrides: Partial<FileItem> & { id: string }): FileItem {
	return {
		kind: "file",
		source: "file",
		group: "files",
		title: overrides.id,
		aliases: [],
		tile: { kind: "icon", icon: "file" },
		path: `${overrides.id}.md`,
		resultKind: "note",
		mtime: 0,
		...overrides,
	};
}

function action(overrides: Partial<ActionDef> & { id: string }): ActionDef {
	return {
		name: overrides.id,
		aliases: [],
		icon: "zap",
		appliesTo: () => true,
		...overrides,
	};
}

/** Registry order IS the product decision — the first survivor is primary. */
const REGISTRY: readonly ActionDef[] = [
	action({ id: "open", appliesTo: (item) => item.kind === "file" }),
	action({ id: "bookmark", requiresCorePlugin: "bookmarks" }),
	action({ id: "kanban-card", requiresPlugin: "obsidian-kanban" }),
	action({ id: "copy-id" }),
];

const caps = (overrides: Partial<PluginCapabilities> = {}): PluginCapabilities => ({
	...NONE_AVAILABLE,
	...overrides,
});

const ctx: BarContext = EMPTY_CONTEXT;

describe("filterAvailable", () => {
	it("keeps everything when everything is available", () => {
		expect(filterAvailable(REGISTRY, ALL_AVAILABLE).map((entry) => entry.id)).toEqual([
			"open",
			"bookmark",
			"kanban-card",
			"copy-id",
		]);
	});

	it("drops an entry whose community plugin is missing", () => {
		const available = filterAvailable(REGISTRY, caps({ isCorePluginEnabled: () => true }));
		expect(available.map((entry) => entry.id)).toEqual(["open", "bookmark", "copy-id"]);
	});

	it("drops an entry whose CORE plugin is missing", () => {
		const available = filterAvailable(REGISTRY, caps({ isPluginEnabled: () => true }));
		expect(available.map((entry) => entry.id)).toEqual(["open", "kanban-card", "copy-id"]);
	});

	it("leaves only the ungated entries with NONE_AVAILABLE", () => {
		const available = filterAvailable(REGISTRY, NONE_AVAILABLE);
		expect(available.map((entry) => entry.id)).toEqual(["open", "copy-id"]);
		expect(available.some((entry) => entry.requiresPlugin !== undefined)).toBe(false);
		expect(available.some((entry) => entry.requiresCorePlugin !== undefined)).toBe(false);
	});

	it("asks the capabilities only about the declared ids", () => {
		const asked: string[] = [];
		const askedCore: string[] = [];
		filterAvailable(REGISTRY, {
			isPluginEnabled: (id) => {
				asked.push(id);
				return true;
			},
			isCorePluginEnabled: (id) => {
				askedCore.push(id);
				return true;
			},
		});
		expect(asked).toEqual(["obsidian-kanban"]);
		expect(askedCore).toEqual(["bookmarks"]);
	});

	it("keeps an entry gated on both once both are enabled", () => {
		const both = [action({ id: "x", requiresPlugin: "p", requiresCorePlugin: "c" })];
		expect(filterAvailable(both, ALL_AVAILABLE)).toHaveLength(1);
		expect(filterAvailable(both, caps({ isPluginEnabled: () => true }))).toEqual([]);
		expect(filterAvailable(both, caps({ isCorePluginEnabled: () => true }))).toEqual([]);
	});

	it("returns a new array and keeps the input untouched", () => {
		const filtered = filterAvailable(REGISTRY, NONE_AVAILABLE);
		expect(filtered).not.toBe(REGISTRY);
		expect(REGISTRY).toHaveLength(4);
	});
});

describe("ALL_AVAILABLE and NONE_AVAILABLE", () => {
	it("answer every id the same way", () => {
		expect(ALL_AVAILABLE.isPluginEnabled("anything")).toBe(true);
		expect(ALL_AVAILABLE.isCorePluginEnabled("anything")).toBe(true);
		expect(NONE_AVAILABLE.isPluginEnabled("anything")).toBe(false);
		expect(NONE_AVAILABLE.isCorePluginEnabled("anything")).toBe(false);
	});
});

describe("actionsFor", () => {
	it("applies the plugin gate and appliesTo together", () => {
		const item = file({ id: "note", title: "Note" });
		expect(actionsFor(REGISTRY, item, ctx, ALL_AVAILABLE).map((a) => a.id)).toEqual([
			"open",
			"bookmark",
			"kanban-card",
			"copy-id",
		]);
		expect(actionsFor(REGISTRY, item, ctx, NONE_AVAILABLE).map((a) => a.id)).toEqual([
			"open",
			"copy-id",
		]);
	});

	it("drops actions that do not apply to the item", () => {
		const item = command({ id: "toggle-bold", title: "Toggle bold" });
		expect(actionsFor(REGISTRY, item, ctx, ALL_AVAILABLE).map((a) => a.id)).toEqual([
			"bookmark",
			"kanban-card",
			"copy-id",
		]);
	});

	it("PRESERVES registry order — the first action is the primary one", () => {
		const registry: readonly ActionDef[] = [
			action({ id: "zeta" }),
			action({ id: "alpha" }),
			action({ id: "mid" }),
		];
		const item = file({ id: "note", title: "Note" });
		expect(actionsFor(registry, item, ctx, ALL_AVAILABLE).map((a) => a.id)).toEqual([
			"zeta",
			"alpha",
			"mid",
		]);
	});

	it("passes the item and the context to appliesTo", () => {
		const seen: Array<{ id: string; selection: string }> = [];
		const registry: readonly ActionDef[] = [
			action({
				id: "probe",
				appliesTo: (item, context) => {
					seen.push({ id: item.id, selection: context.selection });
					return context.selection.length > 0;
				},
			}),
		];
		const item = file({ id: "note", title: "Note" });
		expect(actionsFor(registry, item, ctx, ALL_AVAILABLE)).toEqual([]);
		const withSelection: BarContext = { ...EMPTY_CONTEXT, selection: "hello" };
		expect(actionsFor(registry, item, withSelection, ALL_AVAILABLE)).toHaveLength(1);
		expect(seen).toEqual([
			{ id: "note", selection: "" },
			{ id: "note", selection: "hello" },
		]);
	});

	it("returns nothing for an empty registry", () => {
		expect(actionsFor([], file({ id: "note" }), ctx, ALL_AVAILABLE)).toEqual([]);
	});
});
