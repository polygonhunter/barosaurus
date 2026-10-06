import { TFolder } from "obsidian";
import { fold } from "../core/normalize";
import { containsPhrase } from "../core/query";
import type { Candidate, OmniItem } from "../core/types";
import { folderOf, fuzzyFactory, orderByMatch, type Scorable } from "./files";
import {
	candidatesFromOrdered,
	excluderFor,
	memoOf,
	sourceSettings,
	type Source,
	type SourceContext,
} from "./source";

/**
 * Folders, so "go to my project folder" is one query rather than a sidebar
 * expedition. `vault.getAllLoadedFiles()` is public and already in memory, so
 * this needs no traversal of its own — the `instanceof TFolder` check is the
 * documented way to tell the two apart.
 */
/**
 * Every folder outside the exclusions as a scorable row — built once per
 * open of the bar, then only filtered and ordered per keystroke.
 */
function folderCorpus(ctx: SourceContext): Array<Scorable<OmniItem>> {
	const excluded = sourceSettings(ctx).excludedFolders;
	return memoOf(ctx, `folders:${excluded.join("\n")}`, () => {
		const isExcluded = excluderFor(ctx);
		const entries: Array<Scorable<OmniItem>> = [];
		for (const entry of ctx.app.vault.getAllLoadedFiles()) {
			if (!(entry instanceof TFolder)) continue;
			// The vault root is every path's ancestor and never a useful result.
			if (entry.path === "/" || entry.path.length === 0) continue;
			// The excluded folder itself and everything under it — the check is
			// boundary-aware, so "templates" leaves "templates-archive" alone.
			if (isExcluded(entry.path)) continue;
			const item: OmniItem = {
				id: `folder:${entry.path}`,
				kind: "folder",
				source: "folder",
				group: "folders",
				title: entry.name,
				aliases: [entry.path],
				subtitle: folderOf(entry.path),
				tile: { kind: "icon", icon: "folder" },
				path: entry.path,
				contextTags: ["navigation", "vault"],
			};
			entries.push({
				value: item,
				terms: [fold(entry.name), fold(entry.path)].filter((term) => term.length > 0),
			});
		}
		return entries;
	});
}

export const foldersSource: Source = {
	id: "folder",

	/**
	 * Unscoped queries with no vault-corpus operator: a folder has no kind, no
	 * mtime worth filtering on and no tags, so those operators mean the user is
	 * asking the files source instead. The `p:` prefix is the exception — it
	 * names a folder, so it filters this source rather than excluding it.
	 */
	appliesTo(ctx: SourceContext): boolean {
		return (
			ctx.query.scope === "all" &&
			ctx.query.kind === null &&
			ctx.query.modifiedWithinDays === null &&
			ctx.query.tags.length === 0
		);
	},

	getCandidates(ctx: SourceContext): Candidate[] {
		const { query, limit } = ctx;
		if (limit <= 0) return [];

		const prefix = query.pathPrefix?.toLowerCase() ?? null;
		const entries = folderCorpus(ctx).filter(({ value }) => {
			const path = value.kind === "folder" ? value.path : "";
			if (prefix !== null && !path.toLowerCase().startsWith(prefix)) return false;
			if (query.phrases.some((phrase) => !containsPhrase(path, phrase))) return false;
			return !query.excludes.some((word) => containsPhrase(path, word));
		});

		return candidatesFromOrdered(orderByMatch(entries, fold(query.text), fuzzyFactory, limit));
	},
};
