import type { Candidate, OmniItem } from "../core/types";
import { candidatesFromOrdered, type Source, type SourceContext } from "./source";

/** Action id prefix; the executor parses the line number back out. */
export const GOTO_LINE_PREFIX = "goto-line:";

/**
 * `:42` — jump to a line in the note you are already in.
 *
 * The third sigil, borrowed from VS Code alongside `>` and `@`. Without this
 * source the grammar parsed the scope and every other source declined it, so
 * the bar showed the "Go to line" label above an empty list.
 */
export const lineSource: Source = {
	id: "line",

	appliesTo(ctx: SourceContext): boolean {
		return (
			ctx.query.scope === "line" &&
			ctx.query.line !== null &&
			ctx.query.line > 0 &&
			ctx.bar.activeFile !== null
		);
	},

	getCandidates(ctx: SourceContext): Candidate[] {
		const line = ctx.query.line;
		if (ctx.limit <= 0 || line === null) return [];

		const item: OmniItem = {
			id: `${GOTO_LINE_PREFIX}${line}`,
			kind: "action",
			source: "command",
			group: "actions",
			title: `Go to line ${line}`,
			aliases: [String(line)],
			subtitle: ctx.bar.activeFile ?? undefined,
			tile: { kind: "icon", icon: "corner-down-right" },
			actionId: `${GOTO_LINE_PREFIX}${line}`,
			contextTags: ["editor", "navigation"],
		};
		return candidatesFromOrdered([item]);
	},
};
