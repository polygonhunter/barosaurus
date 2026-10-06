import { getAllTags, type App, type TFile } from "obsidian";
import { fold } from "../core/normalize";
import type { Candidate, OmniItem } from "../core/types";
import { getAllVaultTags } from "../ui/unsafe";
import { fuzzyFactory, orderByMatch, type Scorable } from "./files";
import {
	candidatesFromOrdered,
	excluderFor,
	memoOf,
	sourceSettings,
	type Source,
	type SourceContext,
} from "./source";

/**
 * Every tag in the vault, with its usage count.
 *
 * The public `getAllTags(cache)` answers a different question — the tags of
 * ONE file — so building a vault-wide list from it would mean walking every
 * note on every keystroke. `metadataCache.getTags()` is the internal that
 * already holds the answer, which is why it lives in the quarantine and this
 * source degrades to an empty group when it disappears.
 */

/**
 * Per-file tag list, invalidated by mtime and path — getAllTags allocates an
 * array. A WeakMap on the TFile, so renamed and deleted notes do not linger.
 */
const fileTagCache = new WeakMap<TFile, { mtime: number; path: string; tags: string[] }>();

/** Drop a file's tags once its metadata was re-parsed (see main.ts). */
export function invalidateFileTags(file: TFile): void {
	fileTagCache.delete(file);
}

function tagsOf(app: App, file: TFile): string[] {
	const cached = fileTagCache.get(file);
	if (cached !== undefined && cached.mtime === file.stat.mtime && cached.path === file.path) {
		return cached.tags;
	}
	const cache = app.metadataCache.getFileCache(file);
	const tags =
		cache === null
			? []
			: (getAllTags(cache) ?? []).map((tag) =>
					(tag.startsWith("#") ? tag.slice(1) : tag).toLowerCase(),
				);
	fileTagCache.set(file, { mtime: file.stat.mtime, path: file.path, tags });
	return tags;
}

/**
 * The tags that survive the exclusion list: every tag carried by at least one
 * note OUTSIDE the excluded folders.
 *
 * The vault-wide counts come from an internal that knows nothing about
 * folders, so this is the only way to make "everything inside is skipped" true
 * for a tag that exists nowhere else. It is a walk of the vault — hence the
 * per-file cache, and hence the caller only asking for it when the user has
 * actually configured an exclusion. With none, this never runs.
 *
 * Parents are added along with their children: `#project/design` outside the
 * exclusions keeps `#project` alive, whether or not the internal reports the
 * parent as a tag of its own.
 */
function tagsOutsideExclusions(app: App, isExcluded: (path: string) => boolean): Set<string> {
	const allowed = new Set<string>();
	for (const file of app.vault.getMarkdownFiles()) {
		if (isExcluded(file.path)) continue;
		for (const tag of tagsOf(app, file)) {
			allowed.add(tag);
			for (let cut = tag.lastIndexOf("/"); cut > 0; cut = tag.lastIndexOf("/", cut - 1)) {
				allowed.add(tag.slice(0, cut));
			}
		}
	}
	return allowed;
}

/**
 * Every tag that survives the exclusions, as scorable rows. Built once per
 * open of the bar: the internal tag table and — with exclusions — a walk of
 * every note are far too much to redo per keystroke for a list that cannot
 * change while the user types.
 */
function tagCorpus(ctx: SourceContext): Array<Scorable<OmniItem>> {
	const excluded = sourceSettings(ctx).excludedFolders;
	return memoOf(ctx, `tags:${excluded.join("\n")}`, () => {
		const { app } = ctx;
		// null means "nothing is excluded, keep every tag" — and costs nothing.
		const allowed =
			excluded.length === 0 ? null : tagsOutsideExclusions(app, excluderFor(ctx));

		const entries: Array<Scorable<OmniItem>> = [];
		for (const { tag, count } of getAllVaultTags(app)) {
			const bare = tag.startsWith("#") ? tag.slice(1) : tag;
			if (allowed !== null && !allowed.has(bare.toLowerCase())) continue;
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
			entries.push({ value: item, terms: [fold(bare)].filter((term) => term.length > 0) });
		}
		return entries;
	});
}

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
		const { query, limit } = ctx;
		if (limit <= 0) return [];

		const entries = tagCorpus(ctx);

		// "#proj" is parsed into query.tags, not into query.text — so a bare tag
		// token has to drive this source's own matching or typing a tag would
		// return every tag in the vault.
		const foldedQuery = fold(query.text).length > 0 ? fold(query.text) : (query.tags[0] ?? "");
		return candidatesFromOrdered(orderByMatch(entries, foldedQuery, fuzzyFactory, limit));
	},
};
