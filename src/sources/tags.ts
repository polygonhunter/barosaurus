import { fold } from "../core/normalize";
import type { Candidate, OmniItem } from "../core/types";
import { getAllVaultTags } from "../ui/unsafe";
import { fuzzyFactory, orderByMatch, type Scorable } from "./files";
import { candidatesFromOrdered, type Source, type SourceContext } from "./source";

/**
 * Every tag in the vault, with its usage count.
 *
 * The public `getAllTags(cache)` answers a different question — the tags of
 * ONE file — so building a vault-wide list from it would mean walking every
 * note on every keystroke. `metadataCache.getTags()` is the internal that
 * already holds the answer, which is why it lives in the quarantine and this
 * source degrades to an empty group when it disappears.
 */
export const tagsSource: Source = {
	id: "tag",

	appliesTo(ctx: SourceContext): boolean {
		return (
			ctx.query.scope === "all" &&
			ctx.query.kind === null &&
			ctx.query.pathPrefix === null &&
			ctx.query.modifiedWithinDays === null
		);
	},

	getCandidates(ctx: SourceContext): Candidate[] {
		const { app, query, limit } = ctx;
		if (limit <= 0) return [];

		const entries: Array<Scorable<OmniItem>> = getAllVaultTags(app).map(({ tag, count }) => {
			const bare = tag.startsWith("#") ? tag.slice(1) : tag;
			const item: OmniItem = {
				id: `tag:${bare}`,
				kind: "tag",
				source: "tag",
				group: "tags",
				title: `#${bare}`,
				aliases: [bare],
				subtitle: `${count} ${count === 1 ? "use" : "uses"}`,
				tile: { kind: "icon", icon: "hash" },
				tag: bare,
				count,
				contextTags: ["vault"],
			};
			return { value: item, terms: [fold(bare)].filter((term) => term.length > 0) };
		});

		// "#proj" is parsed into query.tags, not into query.text — so a bare tag
		// token has to drive this source's own matching or typing a tag would
		// return every tag in the vault.
		const foldedQuery = fold(query.text).length > 0 ? fold(query.text) : (query.tags[0] ?? "");
		return candidatesFromOrdered(orderByMatch(entries, foldedQuery, fuzzyFactory, limit));
	},
};
