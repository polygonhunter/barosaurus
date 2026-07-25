import { blockActionId, insertBlocks } from "../core/catalog";
import { fold } from "../core/normalize";
import type { Candidate, OmniItem } from "../core/types";
import { couldMatch, fuzzyFactory, orderByMatch, type Scorable } from "./files";
import { candidatesFromOrdered, sourceSettings, type Source, type SourceContext } from "./source";

/**
 * The things you insert INTO a note: callouts, a code block, a footnote, a
 * horizontal rule, today's date, and the user's own snippets.
 *
 * Obsidian registers commands for a few of these and nothing for the rest, so
 * they cannot come from the commands source — they are Barosaurus' own rows,
 * executed through core/editing.ts. Without this source the whole insert
 * catalog exists, is unit-tested, and is unreachable from the bar.
 *
 * Only offered with an editor open: an insert row on a graph view is a promise
 * the bar cannot keep.
 */
export const blocksSource: Source = {
	id: "block",

	appliesTo(ctx: SourceContext): boolean {
		return (
			ctx.query.scope === "all" &&
			ctx.bar.hasEditor &&
			// These are verbs, not vault objects — a query narrowed by a file
			// operator is not asking for them.
			ctx.query.kind === null &&
			ctx.query.pathPrefix === null &&
			ctx.query.tags.length === 0 &&
			ctx.query.modifiedWithinDays === null
		);
	},

	getCandidates(ctx: SourceContext): Candidate[] {
		if (ctx.limit <= 0) return [];
		const defs = insertBlocks(sourceSettings(ctx).snippets ?? []);
		const foldedQuery = fold(ctx.query.text);

		const entries: Array<Scorable<OmniItem>> = [];
		for (const def of defs) {
			const terms = [def.name, ...def.aliases].map(fold).filter((term) => term.length > 0);
			// Same cheap prefilter as every other source: a subsequence check
			// is a strict superset of what the fuzzy matcher can find, so it
			// costs no recall.
			if (foldedQuery.length > 0 && !terms.some((term) => couldMatch(term, foldedQuery))) {
				continue;
			}
			entries.push({
				value: {
					id: blockActionId(def.id),
					kind: "action",
					source: "command",
					group: "actions",
					title: def.name,
					aliases: def.aliases,
					subtitle: "Insert",
					tile: def.tile,
					actionId: blockActionId(def.id),
					contextTags: ["editor", "formatting", "selection"],
				},
				terms,
			});
		}

		return candidatesFromOrdered(orderByMatch(entries, foldedQuery, fuzzyFactory, ctx.limit));
	},
};
