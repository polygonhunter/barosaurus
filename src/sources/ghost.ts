import { fold } from "../core/normalize";
import type { Candidate, OmniItem } from "../core/types";
import { fuzzyFactory, orderByMatch, type Scorable } from "./files";
import { candidatesFromOrdered, excluderFor, type Source, type SourceContext } from "./source";

/**
 * Ghost notes: wikilinks that point at notes which do not exist yet.
 *
 * `metadataCache.unresolvedLinks` is PUBLIC — a `Record<sourcePath,
 * Record<linktext, count>>` — so no internal is needed here. The judgement
 * calls are all about restraint: a busy vault has hundreds of unresolved
 * links, they are the weakest kind of result in the bar, and a wall of them
 * would bury real notes. Hence: only with a query, capped at three, and every
 * linktext that has since been created is dropped rather than offered as a
 * ghost of a note that exists.
 */

const GHOST_LIMIT = 3;

export const ghostSource: Source = {
	id: "ghost",

	/**
	 * Unscoped queries with actual text. The `l` (link) kind operator points
	 * here on purpose — an unresolved link is the one result family that is
	 * literally a link — while every corpus operator (path, recency, #tag)
	 * excludes this source, because a ghost has no file to filter on.
	 */
	appliesTo(ctx: SourceContext): boolean {
		return (
			ctx.query.scope === "all" &&
			(ctx.query.kind === null || ctx.query.kind === "link") &&
			ctx.query.pathPrefix === null &&
			ctx.query.modifiedWithinDays === null &&
			ctx.query.tags.length === 0 &&
			fold(ctx.query.text).length > 0
		);
	},

	getCandidates(ctx: SourceContext): Candidate[] {
		const { app, query, limit } = ctx;
		const cap = Math.min(limit, GHOST_LIMIT);
		if (cap <= 0) return [];

		// Aggregate first: the same missing note is usually linked from several
		// places, and "linked from 4 notes" is the useful signal.
		const isExcluded = excluderFor(ctx);
		const counts = new Map<string, { linktext: string; sources: number }>();
		// unresolvedLinks is keyed by the SOURCE note's path, so a link that
		// only exists inside an excluded folder is skipped along with it — and
		// its count stops inflating "linked from n notes".
		for (const [notePath, links] of Object.entries(app.metadataCache.unresolvedLinks)) {
			if (links === null || typeof links !== "object") continue;
			if (isExcluded(notePath)) continue;
			for (const linktext of Object.keys(links)) {
				const folded = fold(linktext);
				if (folded.length === 0) continue;
				const existing = counts.get(folded);
				if (existing === undefined) counts.set(folded, { linktext, sources: 1 });
				else existing.sources += 1;
			}
		}

		const entries: Array<Scorable<OmniItem>> = [];
		for (const [folded, { linktext, sources }] of counts) {
			// unresolvedLinks can lag behind reality; a link that resolves today
			// is a real note and the files source owns it.
			if (app.metadataCache.getFirstLinkpathDest(linktext, "") !== null) continue;
			entries.push({
				value: {
					id: `ghost:${linktext}`,
					kind: "ghost",
					source: "ghost",
					group: "create",
					title: linktext,
					aliases: [],
					subtitle: `Not created yet — linked from ${sources} ${sources === 1 ? "note" : "notes"}`,
					tile: { kind: "icon", icon: "unlink" },
					linktext,
				},
				terms: [folded],
			});
		}

		return candidatesFromOrdered(orderByMatch(entries, fold(query.text), fuzzyFactory, cap));
	},
};
