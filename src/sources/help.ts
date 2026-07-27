import { HELP_ENTRIES } from "../core/catalog";
import { fold } from "../core/normalize";
import type { Candidate, OmniItem } from "../core/types";
import { couldMatch, fuzzyFactory, orderByMatch, type Scorable } from "./files";
import { candidatesFromOrdered, type Source, type SourceContext } from "./source";

/**
 * Getting help, as rows in the bar.
 *
 * `supportUrl()` and the issue tracker both existed for six releases with
 * exactly one way in: a button in Settings → About. Typing "bug", "support" or
 * "feedback" into the bar returned nothing, which is the one moment a person is
 * most likely to be typing exactly those words.
 *
 * These are `kind: "action"` items rather than commands: nothing registers them
 * with Obsidian, so the executor reads `actionId` and `runAction` does the rest.
 * They belong to the "actions" group for the same reason the insert blocks do —
 * they are things the bar does, not commands it forwards.
 */
/**
 * How much has to be typed before these are offered at all.
 *
 * Not a style choice — it is the price of the group they are in. `groupRows`
 * orders groups strictly by GROUP_ORDER and "actions" leads it, so an entry
 * here goes above every command and every note with no score able to outrank
 * it. Recall is a subsequence check, so a bare "b" reaches "bug", "h" reaches
 * "help" and "c" reaches "contact": the most ordinary first keystrokes there
 * are would each open the bar with a support link instead of Bold.
 *
 * Three characters is the shortest alias ("bug"), so nothing is lost, and no
 * single keystroke can summon them. Discoverable, not unavoidable.
 */
const MIN_QUERY_LENGTH = 3;

export const helpSource: Source = {
	id: "help",

	/**
	 * Only once enough has been typed to mean it — see MIN_QUERY_LENGTH.
	 *
	 * The rest mirrors the settings-tab source: a query narrowed to a scope, a
	 * kind, a folder, a tag or a date is asking about the vault, and these are
	 * not in it.
	 */
	appliesTo(ctx: SourceContext): boolean {
		return (
			ctx.query.text.trim().length >= MIN_QUERY_LENGTH &&
			ctx.query.scope === "all" &&
			ctx.query.kind === null &&
			ctx.query.pathPrefix === null &&
			ctx.query.modifiedWithinDays === null &&
			ctx.query.tags.length === 0
		);
	},

	getCandidates(ctx: SourceContext): Candidate[] {
		if (ctx.limit <= 0) return [];
		const foldedQuery = fold(ctx.query.text);
		// appliesTo measured the raw text; folding can shrink it (a query of
		// three dots folds to nothing), and an empty query would make the
		// prefilter below match everything — which is the one thing the
		// threshold exists to prevent.
		if (foldedQuery.length < MIN_QUERY_LENGTH) return [];

		const entries: Array<Scorable<OmniItem>> = [];
		for (const entry of HELP_ENTRIES) {
			const terms = [entry.name, ...entry.aliases].map(fold).filter((term) => term.length > 0);
			// The same cheap prefilter every other source uses: a subsequence
			// check is a strict superset of what the fuzzy matcher can find, so
			// it costs no recall.
			if (!terms.some((term) => couldMatch(term, foldedQuery))) continue;
			entries.push({
				value: {
					id: `help:${entry.actionId}`,
					kind: "action",
					source: "command",
					group: "actions",
					title: entry.name,
					aliases: entry.aliases,
					subtitle: "Help and feedback",
					tile: { kind: "icon", icon: entry.icon },
					actionId: entry.actionId,
					contextTags: ["navigation"],
				},
				terms,
			});
		}

		return candidatesFromOrdered(orderByMatch(entries, foldedQuery, fuzzyFactory, ctx.limit));
	},
};
