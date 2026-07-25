import type { App, WorkspaceLeaf } from "obsidian";
import { fold } from "../core/normalize";
import type { Candidate, OmniItem, TileSpec } from "../core/types";
import { getLeafId } from "../ui/unsafe";
import { folderOf, fuzzyFactory, orderByMatch, type Scorable } from "./files";
import { candidatesFromOrdered, type Source, type SourceContext } from "./source";

/**
 * The tabs you already have open. Cheapest source in the bar and usually the
 * one the user meant: switching to an open note beats re-opening it.
 *
 * ── The 1.7.2 trap ─────────────────────────────────────────────────────────
 * Since Obsidian 1.7.2 background tabs are DEFERRED: `leaf.isDeferred` is true
 * and `leaf.view` is a `DeferredView`, NOT the `MarkdownView` every pre-1.7.2
 * plugin casts it to. So this file never touches `leaf.view` at all — the file
 * path comes from `leaf.getViewState()`, which is public, synchronous and
 * correct for deferred and loaded leaves alike. And it never calls
 * `loadIfDeferred()`: forcing every background tab to load in order to draw a
 * list is exactly the cost deferred views exist to avoid.
 */

const VIEW_ICONS: Record<string, string> = {
	markdown: "file-text",
	canvas: "layout-dashboard",
	pdf: "file",
	image: "image",
	graph: "git-fork",
	"localgraph": "git-fork",
	audio: "file-audio",
	video: "file-video",
	bases: "table",
};

/** Human label for a view type with no file, e.g. "graph" → "Graph". */
function viewLabel(type: string): string {
	const spaced = type.replace(/[-_]/g, " ");
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function pathOf(leaf: WorkspaceLeaf): string | undefined {
	const state = leaf.getViewState();
	const file = state.state?.["file"];
	return typeof file === "string" && file.length > 0 ? file : undefined;
}

function basenameOf(path: string): string {
	const file = path.slice(path.lastIndexOf("/") + 1);
	const dot = file.lastIndexOf(".");
	return dot > 0 ? file.slice(0, dot) : file;
}

function tileFor(type: string): TileSpec {
	return { kind: "icon", icon: VIEW_ICONS[type] ?? "file" };
}

/** Main-area tabs only: the sidebars are panels, not tabs you switch between. */
function isMainAreaLeaf(app: App, leaf: WorkspaceLeaf): boolean {
	const root = leaf.getRoot();
	return root !== app.workspace.leftSplit && root !== app.workspace.rightSplit;
}

function itemFor(leaf: WorkspaceLeaf, index: number): OmniItem | null {
	const state = leaf.getViewState();
	const type = state.type;
	if (type === "empty") return null;

	const path = pathOf(leaf);
	// getDisplayText() is public on the LEAF (not on the deferred view), so it
	// is safe here; the path-derived name is preferred because it is what the
	// user typed when they created the note.
	const title = path === undefined ? leaf.getDisplayText() : basenameOf(path);
	if (title.length === 0) return null;

	const leafId = getLeafId(leaf);
	const subtitle = path === undefined ? viewLabel(type) : folderOf(path);
	const aliases = path === undefined ? [] : [path];

	return {
		id: `tab:${leafId ?? path ?? String(index)}`,
		kind: "tab",
		source: "tab",
		group: "openTabs",
		title,
		aliases,
		subtitle,
		tile: tileFor(type),
		leafId: leafId ?? "",
		path,
		contextTags: ["navigation"],
	};
}

export const tabsSource: Source = {
	id: "tab",

	/**
	 * Unscoped queries only. A kind letter, a path prefix, a recency window or
	 * a #tag are all statements about the vault corpus, and the open-tab list
	 * is a workspace fact, not a corpus query.
	 */
	appliesTo(ctx: SourceContext): boolean {
		return (
			ctx.query.scope === "all" &&
			ctx.query.kind === null &&
			ctx.query.pathPrefix === null &&
			ctx.query.modifiedWithinDays === null &&
			ctx.query.tags.length === 0
		);
	},

	getCandidates(ctx: SourceContext): Candidate[] {
		const { app, query, limit } = ctx;
		if (limit <= 0) return [];

		const entries: Array<Scorable<OmniItem>> = [];
		const seen = new Set<string>();
		let index = 0;
		app.workspace.iterateAllLeaves((leaf) => {
			if (!isMainAreaLeaf(app, leaf)) return;
			const item = itemFor(leaf, index);
			index += 1;
			if (item === null || seen.has(item.id)) return;
			seen.add(item.id);
			entries.push({
				value: item,
				terms: [fold(item.title), ...item.aliases.map(fold)].filter((t) => t.length > 0),
			});
		});

		return candidatesFromOrdered(orderByMatch(entries, fold(query.text), fuzzyFactory, limit));
	},
};
