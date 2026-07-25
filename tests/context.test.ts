import { describe, expect, it } from "vitest";
import {
	contextBoosts,
	DEFAULT_CONTEXT_RULES,
	explainBoost,
	type ContextRule,
} from "../src/core/context";
import { rankCandidates } from "../src/core/rank";
import type { BarContext, Candidate, OmniItem } from "../src/core/types";
import { EMPTY_CONTEXT } from "../src/core/types";

type CommandItem = Extract<OmniItem, { kind: "command" }>;
type FileItem = Extract<OmniItem, { kind: "file" }>;
type HeadingItem = Extract<OmniItem, { kind: "heading" }>;

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

function heading(overrides: Partial<HeadingItem> & { id: string }): HeadingItem {
	return {
		kind: "heading",
		source: "heading",
		group: "structure",
		title: overrides.id,
		aliases: [],
		tile: { kind: "heading", level: 2 },
		path: "Other.md",
		level: 2,
		line: 3,
		...overrides,
	};
}

const context = (overrides: Partial<BarContext> = {}): BarContext => ({
	...EMPTY_CONTEXT,
	...overrides,
});

const editing = context({ selection: "a whole sentence", hasEditor: true, viewType: "markdown" });

const boostOf = (item: OmniItem, ctx: BarContext, rules?: readonly ContextRule[]): number =>
	contextBoosts([item], ctx, rules ?? DEFAULT_CONTEXT_RULES)[item.id] ?? 0;

const ruleIds = (item: OmniItem, ctx: BarContext): string[] =>
	explainBoost(item, ctx).map((rule) => rule.id);

describe("DEFAULT_CONTEXT_RULES", () => {
	it("has unique ids and a stated reason for every rule", () => {
		const ids = DEFAULT_CONTEXT_RULES.map((rule) => rule.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const rule of DEFAULT_CONTEXT_RULES) {
			expect(rule.reason.length, rule.id).toBeGreaterThan(0);
			expect(rule.boost, rule.id).not.toBe(0);
		}
	});
});

describe("contextBoosts — with a selection", () => {
	it("puts a selection verb above something that is only formatting", () => {
		const verb = command({ id: "wrap", contextTags: ["selection"] });
		const formatting = command({ id: "bold", contextTags: ["formatting"] });
		expect(boostOf(verb, editing)).toBeGreaterThan(boostOf(formatting, editing));
		expect(boostOf(verb, editing)).toBe(0.6);
		expect(boostOf(formatting, editing)).toBe(0.45);
	});

	it("stacks the rules that apply to the same item", () => {
		const bold = command({ id: "bold", contextTags: ["selection", "formatting", "editor"] });
		expect(boostOf(bold, editing)).toBeCloseTo(0.6 + 0.45 + 0.2);
	});

	it("ignores the selection rules once nothing is selected", () => {
		const withEditor = context({ hasEditor: true });
		const verb = command({ id: "wrap", contextTags: ["selection"] });
		expect(boostOf(verb, withEditor)).toBe(0);
	});
});

describe("contextBoosts — without an editor", () => {
	it("gives formatting a NEGATIVE boost rather than hiding it", () => {
		const bold = command({ id: "bold", contextTags: ["formatting"] });
		expect(boostOf(bold, EMPTY_CONTEXT)).toBe(-0.5);
	});

	it("does not boost editor commands", () => {
		const cmd = command({ id: "insert", contextTags: ["editor"] });
		expect(boostOf(cmd, EMPTY_CONTEXT)).toBe(0);
		expect(boostOf(cmd, context({ hasEditor: true }))).toBe(0.2);
	});
});

describe("contextBoosts — the active file", () => {
	const ctx = context({ activeFile: "Projects/Barosaurus.md" });

	it("boosts a heading of the note you are in", () => {
		expect(boostOf(heading({ id: "h1", path: "Projects/Barosaurus.md" }), ctx)).toBe(0.35);
		expect(boostOf(heading({ id: "h2", path: "Other.md" }), ctx)).toBe(0);
	});

	it("demotes the active file itself", () => {
		expect(boostOf(file({ id: "self", path: "Projects/Barosaurus.md" }), ctx)).toBe(-0.4);
		expect(boostOf(file({ id: "other", path: "Other.md" }), ctx)).toBe(0);
	});

	it("does nothing when no file is active", () => {
		expect(boostOf(file({ id: "any", path: "Other.md" }), EMPTY_CONTEXT)).toBe(0);
	});
});

describe("contextBoosts — the returned map", () => {
	it("omits items with no applicable rule instead of storing 0", () => {
		const plain = command({ id: "plain" });
		const bold = command({ id: "bold", contextTags: ["formatting"] });
		const boosts = contextBoosts([plain, bold], editing);
		expect(Object.keys(boosts)).toEqual(["bold"]);
		expect("plain" in boosts).toBe(false);
	});

	it("omits an item whose rules cancel out exactly", () => {
		const rules: readonly ContextRule[] = [
			{ id: "up", reason: "up", applies: () => true, boost: 0.5 },
			{ id: "down", reason: "down", applies: () => true, boost: -0.5 },
		];
		expect(contextBoosts([command({ id: "x" })], editing, rules)).toEqual({});
	});

	it("is empty for no items", () => {
		expect(contextBoosts([], editing)).toEqual({});
	});

	it("honours a custom rule table", () => {
		const rules: readonly ContextRule[] = [
			{ id: "canvas-only", reason: "canvas", applies: (_, c) => c.viewType === "canvas", boost: 2 },
		];
		expect(contextBoosts([command({ id: "x" })], editing, rules)).toEqual({});
		expect(contextBoosts([command({ id: "x" })], context({ viewType: "canvas" }), rules)).toEqual({
			x: 2,
		});
	});
});

describe("explainBoost", () => {
	it("lists exactly the rules that fired, in table order", () => {
		const bold = command({ id: "bold", contextTags: ["selection", "formatting", "editor"] });
		expect(ruleIds(bold, editing)).toEqual([
			"selection-verbs",
			"selection-formatting",
			"editor-commands",
		]);
	});

	it("lists the demotion when the editor is gone", () => {
		const bold = command({ id: "bold", contextTags: ["formatting"] });
		expect(ruleIds(bold, EMPTY_CONTEXT)).toEqual(["no-editor-demotes-formatting"]);
	});

	it("lists nothing for an item no rule touches", () => {
		expect(ruleIds(command({ id: "plain" }), editing)).toEqual([]);
	});

	it("explains the canvas rule", () => {
		const item = command({ id: "canvas-card", contextTags: ["canvas"] });
		expect(ruleIds(item, context({ viewType: "canvas" }))).toEqual(["canvas-view"]);
		expect(ruleIds(item, context({ viewType: "markdown" }))).toEqual([]);
	});
});

describe("context ranking — the acid test", () => {
	const bold = command({
		id: "bold",
		title: "Bold",
		contextTags: ["formatting", "selection", "editor"],
	});
	const candidates: readonly Candidate[] = [
		{ item: file({ id: "budget", title: "Budget 2026" }), norm: 1 },
		{ item: file({ id: "bathroom", title: "Bathroom" }), norm: 0.9 },
		{ item: bold, norm: 0.5 },
	];

	const rank = (ctx: BarContext, query: string): string[] =>
		rankCandidates(candidates, query, ctx, {
			contextBoost: contextBoosts(
				candidates.map((candidate) => candidate.item),
				ctx,
			),
		}).map((ranked) => ranked.item.id);

	it("select a sentence, type 'b': Bold is the first row", () => {
		expect(rank(editing, "b")[0]).toBe("bold");
	});

	it("close the editor and Bold drops back below the notes", () => {
		expect(rank(EMPTY_CONTEXT, "b")[0]).toBe("budget");
		expect(rank(EMPTY_CONTEXT, "b").indexOf("bold")).toBe(2);
	});

	it("type 'h2' and Heading 2 wins on its acronym", () => {
		const heading2 = command({ id: "heading-2", title: "Heading 2", contextTags: ["editor"] });
		const ranked = rankCandidates(
			[
				{ item: file({ id: "hydrogen", title: "Hydrogen notes" }), norm: 1 },
				{ item: heading2, norm: 0.1 },
			],
			"h2",
			editing,
			{ contextBoost: contextBoosts([heading2], editing) },
		);
		expect(ranked[0]?.item.id).toBe("heading-2");
	});
});
