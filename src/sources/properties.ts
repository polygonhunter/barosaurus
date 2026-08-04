import type { Candidate, OmniItem } from "../core/types";
import { fold } from "../core/normalize";
import { candidatesFromOrdered, type Source, type SourceContext } from "./source";

/**
 * Properties of the note you are already in.
 *
 * Every other action in the bar acts on a result you had to find first: type
 * the note's name, highlight it, ⌘K, pick the verb. For a property that is the
 * wrong shape — you are looking AT the note, and having to search for it to set
 * its author is the long way round a door you are standing in.
 *
 * So this source offers the verb directly, targeted at the active file, in
 * group "actions" — already the first entry in GROUP_ORDER, so the row lands at
 * the top without a ranking special case. `lineSource` is the same idea for
 * `:42`.
 *
 * The id carries the target path because the row is a `kind: "action"` and
 * therefore has no path of its own, exactly like SETTINGS_ACTION_PREFIX and
 * GOTO_LINE_PREFIX. The modal parses it back out and hands the flow a real file
 * item, which is what lets a TWO-argument action start from the root level.
 */

export const SET_PROPERTY_PREFIX = "set-property-on:";
export const REMOVE_PROPERTY_PREFIX = "remove-property-on:";

/**
 * Separator between the target path and an already-named key.
 *
 * NUL, because it is the one character neither a vault path nor a property
 * name can contain. A space reads better and is wrong: "Projects/Q3 report.md"
 * would split at "Q3" and the flow would write to a note that does not exist.
 * Written as an escape rather than typed literally — a raw NUL in a source file
 * is invisible in a diff and makes grep call the file binary.
 */
const SEP = "\u0000";

/** Split "<prefix><path>" or "<prefix><path>\0<key>" into the pieces the flow needs. */
export function parsePropertyAction(
	actionId: string,
): { action: "set-property" | "remove-property"; path: string; key: string | null } | null {
	for (const [prefix, action] of [
		[SET_PROPERTY_PREFIX, "set-property"],
		[REMOVE_PROPERTY_PREFIX, "remove-property"],
	] as const) {
		if (!actionId.startsWith(prefix)) continue;
		const rest = actionId.slice(prefix.length);
		// The key is present when the row named a specific property, which lets
		// the flow skip that page and ask straight for the value.
		const [path = "", key] = rest.split(SEP);
		if (path.length === 0) return null;
		return { action, path, key: key === undefined || key.length === 0 ? null : key };
	}
	return null;
}

/**
 * Keys worth offering by name. Read from the vault would mean a metadata scan
 * on every keystroke of every query; the picker does that once, when it opens.
 * These are the fields people reach for, and typing anything else still finds
 * the generic row below.
 */
const COMMON_KEYS = ["author", "status", "tags", "aliases", "date", "due", "project", "type"];

export const propertiesSource: Source = {
	id: "properties",

	/** Only with a note open: the whole point is that it needs no target. */
	appliesTo(ctx: SourceContext): boolean {
		return (
			ctx.query.scope === "all" && ctx.query.text.trim().length > 0 && ctx.bar.activeFile !== null
		);
	},

	getCandidates(ctx: SourceContext): Candidate[] {
		const path = ctx.bar.activeFile;
		if (ctx.limit <= 0 || path === null) return [];
		const query = fold(ctx.query.text.trim());
		if (query.length === 0) return [];

		const name = path.split("/").pop() ?? path;
		const rows: OmniItem[] = [];

		// A named key first, when the query is clearly reaching for one.
		for (const key of COMMON_KEYS) {
			if (!fold(key).startsWith(query)) continue;
			rows.push({
				id: `${SET_PROPERTY_PREFIX}${path}${SEP}${key}`,
				kind: "action",
				source: "command",
				group: "actions",
				title: `Set ${key}…`,
				aliases: [key, `set ${key}`, "property"],
				subtitle: name,
				tile: { kind: "icon", icon: "list-plus" },
				actionId: `${SET_PROPERTY_PREFIX}${path}${SEP}${key}`,
				contextTags: ["editor"],
			});
		}

		// The generic pair, for everything the shortlist does not cover.
		if ("set property".includes(query) || "property".startsWith(query) || query === "frontmatter") {
			rows.push({
				id: `${SET_PROPERTY_PREFIX}${path}`,
				kind: "action",
				source: "command",
				group: "actions",
				title: "Set property…",
				aliases: ["property", "frontmatter", "metadata"],
				subtitle: name,
				tile: { kind: "icon", icon: "list-plus" },
				actionId: `${SET_PROPERTY_PREFIX}${path}`,
				contextTags: ["editor"],
			});
		}
		if ("remove property".includes(query) && query.length >= 3) {
			rows.push({
				id: `${REMOVE_PROPERTY_PREFIX}${path}`,
				kind: "action",
				source: "command",
				group: "actions",
				title: "Remove property…",
				aliases: ["remove property", "clear property"],
				subtitle: name,
				tile: { kind: "icon", icon: "list-x" },
				actionId: `${REMOVE_PROPERTY_PREFIX}${path}`,
				contextTags: ["editor"],
			});
		}

		return candidatesFromOrdered(rows.slice(0, ctx.limit));
	},
};
