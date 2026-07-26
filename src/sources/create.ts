import { normalizePath } from "obsidian";
import type { Candidate, OmniItem } from "../core/types";
import { candidatesFromOrdered, type Source, type SourceContext } from "./source";

/**
 * The escape hatch: "create note X" when nothing matched.
 *
 * Exactly one row, only ever with a query, and always last (group "create" is
 * the final entry in GROUP_ORDER). It is deliberately not hidden when other
 * results exist — a bar that only offers creation after you have proven the
 * note is missing makes you type twice.
 *
 * The title is `Create note "X"` rather than the bare X on purpose: an item
 * whose title EQUALS the query lands in the exact-match tier, and the tier
 * dominates the ranking absolutely, so a bare title would put this row above
 * the note you were actually looking for.
 */

/** Characters Obsidian refuses in a file name. */
const ILLEGAL_CHARS = /[\\/:*?"<>|#^[\]]/g;

/**
 * Turn typed text into a note path. Exported so the executor creates exactly
 * the path the row promised — `normalizePath()` per the repo rules, and the
 * `p:` prefix of the query doubles as the target folder.
 */
export function createNotePath(text: string, folder: string | null): string {
	const name = text.replace(ILLEGAL_CHARS, " ").replace(/\s+/g, " ").trim();
	const parent = (folder ?? "").replace(/^\/+|\/+$/g, "");
	const withExtension = name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
	return normalizePath(parent.length > 0 ? `${parent}/${withExtension}` : withExtension);
}

export const createSource: Source = {
	id: "create",

	/**
	 * Only for an unscoped query with text: ">" wants commands, "@" wants the
	 * outline, ":42" wants a line, and an empty bar is the launcher — none of
	 * them is asking to create a note. The image and link kinds are ruled out
	 * too; this row makes a markdown note and nothing else.
	 */
	appliesTo(ctx: SourceContext): boolean {
		return (
			ctx.query.scope === "all" &&
			(ctx.query.kind === null || ctx.query.kind === "note" || ctx.query.kind === "file") &&
			ctx.query.text.trim().length > 0
		);
	},

	getCandidates(ctx: SourceContext): Candidate[] {
		const { query, limit } = ctx;
		if (limit <= 0) return [];
		const text = query.text.trim();
		const path = createNotePath(text, query.pathPrefix);
		if (path === ".md" || path.length === 0) return [];

		const item: OmniItem = {
			id: `create:${path}`,
			kind: "create",
			source: "create",
			group: "create",
			title: `Create note "${text}"`,
			aliases: ["new note", "create note", text],
			subtitle: path,
			tile: { kind: "icon", icon: "file-plus" },
			query: text,
			path,
		};
		return candidatesFromOrdered([item]);
	},
};
