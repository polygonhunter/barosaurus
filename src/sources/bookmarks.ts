import { fold } from "../core/normalize";
import type { Candidate, OmniItem } from "../core/types";
import { getBookmarkItems, isCorePluginEnabled } from "../ui/unsafe";
import { folderOf, fuzzyFactory, orderByMatch, type Scorable } from "./files";
import { candidatesFromOrdered, type Source, type SourceContext } from "./source";

/**
 * Bookmarks of the core plugin.
 *
 * The plugin exposes no API at all, so both halves of this source live behind
 * the quarantine: `isCorePluginEnabled` decides whether the group exists, and
 * `getBookmarkItems` flattens the group tree. With the core plugin off, or its
 * internals renamed, `appliesTo` is false and the group vanishes — header
 * included — instead of rendering an empty section.
 */
export const bookmarksSource: Source = {
	id: "bookmark",

	appliesTo(ctx: SourceContext): boolean {
		if (ctx.query.scope !== "all") return false;
		if (
			ctx.query.kind !== null ||
			ctx.query.pathPrefix !== null ||
			ctx.query.modifiedWithinDays !== null ||
			ctx.query.tags.length > 0
		) {
			return false;
		}
		return isCorePluginEnabled(ctx.app, "bookmarks");
	},

	getCandidates(ctx: SourceContext): Candidate[] {
		const { app, query, limit } = ctx;
		if (limit <= 0) return [];

		const entries: Array<Scorable<OmniItem>> = [];
		const seen = new Set<string>();
		let index = 0;
		for (const bookmark of getBookmarkItems(app)) {
			const id = `bookmark:${bookmark.path ?? bookmark.title}`;
			index += 1;
			if (seen.has(id)) continue;
			seen.add(id);
			const item: OmniItem = {
				id,
				kind: "bookmark",
				source: "bookmark",
				group: "bookmarks",
				title: bookmark.title,
				aliases: bookmark.path === undefined ? [] : [bookmark.path],
				subtitle: bookmark.path === undefined ? undefined : folderOf(bookmark.path),
				tile: { kind: "icon", icon: "bookmark" },
				path: bookmark.path,
			};
			entries.push({
				value: item,
				terms: [fold(item.title), ...item.aliases.map(fold)].filter((term) => term.length > 0),
			});
			if (index >= 500) break;
		}

		return candidatesFromOrdered(orderByMatch(entries, fold(query.text), fuzzyFactory, limit));
	},
};
