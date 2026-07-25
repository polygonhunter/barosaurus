import type { BarContext, OmniItem } from "./types";

/**
 * Context ranking — the requirement the whole bar is built around.
 *
 * Select a sentence and type "b": Bold has to be the first row, ahead of every
 * note whose title starts with b. Type "h2" and Heading 2 wins. Close the
 * editor and both drop back down, because they cannot do anything.
 *
 * This is deliberately a small table of pure rules rather than logic sprinkled
 * through the ranker: the rules are the product decision, and a table can be
 * read, tested and argued about. Boosts are additive on the already-normalized
 * [0,1] score, so a rule is a thumb on the scale — it re-orders within a match
 * tier and never smuggles a non-matching item into the list.
 */

export interface ContextRule {
	id: string;
	/** Why this exists, shown nowhere — but the tests assert on it. */
	reason: string;
	applies(item: OmniItem, ctx: BarContext): boolean;
	boost: number;
}

function hasTag(item: OmniItem, tag: string): boolean {
	return item.contextTags?.includes(tag) ?? false;
}

export const DEFAULT_CONTEXT_RULES: readonly ContextRule[] = [
	{
		id: "selection-verbs",
		reason: "Text is selected, so verbs that consume a selection are what you meant.",
		applies: (item, ctx) => ctx.selection.length > 0 && hasTag(item, "selection"),
		boost: 0.6,
	},
	{
		id: "selection-formatting",
		reason: "Formatting acts on a selection; with one active it outranks navigation.",
		applies: (item, ctx) => ctx.selection.length > 0 && hasTag(item, "formatting"),
		boost: 0.45,
	},
	{
		id: "editor-commands",
		reason: "An editor has focus, so commands that write into it are reachable.",
		applies: (item, ctx) => ctx.hasEditor && hasTag(item, "editor"),
		boost: 0.2,
	},
	{
		id: "no-editor-demotes-formatting",
		reason: "Without an editor, formatting cannot run — sink it rather than hide it.",
		applies: (item, ctx) => !ctx.hasEditor && hasTag(item, "formatting"),
		boost: -0.5,
	},
	{
		id: "active-file-structure",
		reason: "Headings and blocks of the note you are in beat those of other notes.",
		applies: (item, ctx) =>
			ctx.activeFile !== null &&
			(item.kind === "heading" || item.kind === "block") &&
			item.path === ctx.activeFile,
		boost: 0.35,
	},
	{
		id: "demote-active-file-itself",
		reason: "The note you are already looking at is rarely the note you are looking for.",
		applies: (item, ctx) =>
			ctx.activeFile !== null && item.kind === "file" && item.path === ctx.activeFile,
		boost: -0.4,
	},
	{
		id: "canvas-view",
		reason: "In a canvas, canvas-aware entries are the relevant ones.",
		applies: (item, ctx) => ctx.viewType === "canvas" && hasTag(item, "canvas"),
		boost: 0.3,
	},
];

/**
 * Boost per item id, ready to hand to rankCandidates. Items with no
 * applicable rule are absent rather than zero, so the map stays small.
 */
export function contextBoosts(
	items: readonly OmniItem[],
	ctx: BarContext,
	rules: readonly ContextRule[] = DEFAULT_CONTEXT_RULES,
): Record<string, number> {
	const boosts: Record<string, number> = {};
	for (const item of items) {
		let total = 0;
		for (const rule of rules) {
			if (rule.applies(item, ctx)) total += rule.boost;
		}
		if (total !== 0) boosts[item.id] = total;
	}
	return boosts;
}

/** Which rules fired for one item — used by tests and by the settings preview. */
export function explainBoost(
	item: OmniItem,
	ctx: BarContext,
	rules: readonly ContextRule[] = DEFAULT_CONTEXT_RULES,
): ContextRule[] {
	return rules.filter((rule) => rule.applies(item, ctx));
}
