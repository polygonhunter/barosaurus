import { frecencyKeyFor, type ActionDef, type ArgumentPicker, type OmniItem } from "./types";

/**
 * The ⌘K panel.
 *
 * Registry ORDER is a product decision, not an implementation detail: the
 * first applicable action is the primary one, and Enter runs it. So "Open" has
 * to precede "Rename" for a file, and "Run" has to precede everything for a
 * command.
 *
 * Every `appliesTo` is pure, which is what makes the whole panel testable
 * without an App. Anything that needs Obsidian happens later, in the executor.
 */

/**
 * A Markdown note. Frontmatter lives only there: processFrontMatter on a
 * canvas writes YAML over its JSON, on a PDF over its bytes.
 */
function isNote(item: OmniItem): boolean {
	return item.kind === "file" && item.resultKind === "note";
}

function isFileLike(item: OmniItem): boolean {
	return (
		item.kind === "file" ||
		item.kind === "heading" ||
		item.kind === "block" ||
		item.kind === "bookmark"
	);
}

/** Items that resolve to a real path on disk. */
function hasPath(item: OmniItem): boolean {
	return (
		(item.kind === "file" ||
			item.kind === "heading" ||
			item.kind === "block" ||
			item.kind === "folder") ||
		((item.kind === "bookmark" || item.kind === "tab") && item.path !== undefined)
	);
}

export const ACTIONS: readonly ActionDef[] = [
	// ---------------------------------------------------------- primary
	{
		id: "run",
		name: "Run",
		aliases: ["run", "execute"],
		icon: "play",
		shortcut: "↵",
		appliesTo: (item) => item.kind === "command" || item.kind === "action",
	},
	{
		id: "open",
		name: "Open",
		aliases: ["open", "run"],
		icon: "file-text",
		shortcut: "↵",
		appliesTo: (item) => isFileLike(item) || item.kind === "folder" || item.kind === "tab",
	},
	{
		id: "create-note",
		name: "Create note",
		aliases: ["create", "new note", "create note"],
		icon: "file-plus",
		shortcut: "↵",
		appliesTo: (item) => item.kind === "create" || item.kind === "ghost",
	},

	// ---------------------------------------------------------- opening
	{
		id: "open-new-tab",
		name: "Open in new tab",
		aliases: ["new tab"],
		icon: "plus",
		shortcut: "⌘↵",
		appliesTo: (item) => isFileLike(item),
	},
	{
		id: "open-split",
		name: "Open to the right",
		aliases: ["split", "open right", "side by side"],
		icon: "separator-vertical",
		shortcut: "⌘⌥↵",
		appliesTo: (item) => isFileLike(item),
	},
	{
		id: "open-window",
		name: "Open in new window",
		aliases: ["new window", "popout"],
		icon: "picture-in-picture-2",
		shortcut: "⌘⌥⇧↵",
		appliesTo: (item) => isFileLike(item),
	},

	// ---------------------------------------------------------- linking
	{
		id: "insert-link",
		name: "Insert link at cursor",
		aliases: ["insert link", "link"],
		icon: "link",
		shortcut: "⇥",
		appliesTo: (item, ctx) => ctx.hasEditor && isFileLike(item),
	},
	{
		id: "copy-link",
		name: "Copy link",
		aliases: ["copy link"],
		icon: "copy",
		shortcut: "⌘C",
		appliesTo: (item) => isFileLike(item),
	},
	{
		id: "copy-uri",
		name: "Copy Obsidian URI",
		aliases: ["obsidian url", "copy uri", "deep link"],
		icon: "external-link",
		appliesTo: (item) => hasPath(item),
	},

	// ---------------------------------------------------------- file ops
	{
		id: "rename",
		name: "Rename…",
		aliases: ["rename"],
		icon: "pencil",
		arguments: [{ kind: "text", prompt: "New name", placeholder: "Name" }],
		appliesTo: (item) => item.kind === "file" || item.kind === "folder",
	},
	{
		id: "move",
		name: "Move to…",
		aliases: ["move", "move to folder"],
		icon: "folder-input",
		arguments: [{ kind: "folder", prompt: "Move to folder" }],
		appliesTo: (item) => item.kind === "file" || item.kind === "folder",
	},
	{
		id: "add-tag",
		name: "Add tag…",
		aliases: ["add tag", "tag"],
		icon: "hash",
		arguments: [{ kind: "tag", prompt: "Tag" }],
		appliesTo: (item) => isNote(item),
	},
	/**
	 * The first two-argument actions in the registry: a key, then a value.
	 * `tags` had a dedicated action long before this; it stays, because "Add
	 * tag…" appends to a list while this one sets a field.
	 */
	{
		id: "set-property",
		name: "Set property…",
		aliases: ["set property", "property", "frontmatter", "author", "status", "metadata"],
		icon: "list-plus",
		arguments: [
			{ kind: "property", prompt: "Property" },
			{ kind: "propertyValue", prompt: "Value" },
		],
		appliesTo: (item) => isNote(item),
	},
	{
		id: "remove-property",
		name: "Remove property…",
		aliases: ["remove property", "delete property", "clear property"],
		icon: "list-x",
		arguments: [{ kind: "property", prompt: "Property" }],
		appliesTo: (item) => isNote(item),
	},
	{
		id: "bookmark",
		name: "Bookmark",
		aliases: ["bookmark", "save"],
		icon: "bookmark",
		requiresCorePlugin: "bookmarks",
		// Files only, with a real path. The executor bookmarks by opening the
		// thing and running "bookmark current file" on it: a folder cannot be
		// opened, so for a folder that bookmarked whatever note was active.
		appliesTo: (item) => isFileLike(item) && hasPath(item),
	},
	{
		id: "append-daily",
		name: "Append to daily note",
		aliases: ["daily note", "journal", "append to daily note"],
		icon: "calendar-plus",
		requiresCorePlugin: "daily-notes",
		appliesTo: (item) => isFileLike(item),
	},
	{
		id: "reveal-explorer",
		name: "Show in file explorer",
		aliases: ["reveal", "file tree", "show in explorer"],
		icon: "folder-tree",
		requiresCorePlugin: "file-explorer",
		appliesTo: (item) => hasPath(item),
	},
	{
		id: "reveal-system",
		name: "Show in system folder",
		aliases: ["finder", "explorer", "system", "show in folder"],
		icon: "external-link",
		appliesTo: (item) => hasPath(item),
	},
	{
		id: "delete",
		name: "Delete",
		aliases: ["delete", "trash", "remove"],
		icon: "trash-2",
		appliesTo: (item) => item.kind === "file" || item.kind === "folder",
	},

	// ---------------------------------------------------------- commands
	{
		id: "assign-hotkey",
		name: "Assign hotkey…",
		aliases: ["hotkey", "shortcut", "assign shortcut"],
		icon: "keyboard",
		appliesTo: (item) => item.kind === "command",
	},
	{
		id: "pin",
		name: "Pin",
		aliases: ["pin", "keep on top"],
		icon: "pin",
		shortcut: "⌘P",
		appliesTo: () => true,
	},
	{
		id: "hide",
		name: "Hide from this bar",
		aliases: ["hide", "conceal"],
		icon: "eye-off",
		appliesTo: (item) => item.kind === "command",
	},
	{
		id: "run-command-on",
		name: "Run any command on this…",
		aliases: ["run command", "apply command", "run command on"],
		icon: "terminal",
		arguments: [{ kind: "text", prompt: "Command", placeholder: "Search commands" }],
		appliesTo: (item) => isFileLike(item),
	},

	// ---------------------------------------------------------- selection
	// The verbs that make the bar a doer rather than a finder. Every one of
	// them consumes the selection; without one they are not offered at all.
	{
		id: "extract-note",
		name: "Extract to new note",
		aliases: ["extract", "extract to new note", "split out"],
		icon: "file-output",
		arguments: [{ kind: "text", prompt: "Note title", placeholder: "Title" }],
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
	{
		id: "wrap-callout",
		name: "Wrap in callout…",
		aliases: ["callout", "box", "wrap in callout"],
		icon: "quote",
		arguments: [{ kind: "text", prompt: "Callout type", placeholder: "note, warning, tip…" }],
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
	{
		id: "to-task",
		name: "Turn into task list",
		aliases: ["todo", "task list", "checklist", "turn into tasks"],
		icon: "list-checks",
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
	{
		id: "to-bullets",
		name: "Turn into bullet points",
		aliases: ["bullets", "bullet list", "to list"],
		icon: "list",
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
	{
		id: "to-quote",
		name: "Turn into quote",
		aliases: ["quote", "blockquote", "turn into quote"],
		icon: "text-quote",
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
	{
		id: "link-from-selection",
		name: "Create link from selection",
		aliases: ["create link", "link from selection", "make note"],
		icon: "link-2",
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
	{
		id: "text-color",
		name: "Text colour…",
		aliases: ["text colour", "text color", "colour", "color"],
		icon: "palette",
		arguments: [{ kind: "color", prompt: "Colour" }],
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
	{
		id: "background-color",
		name: "Highlight colour…",
		aliases: ["background colour", "background color", "highlight"],
		icon: "highlighter",
		arguments: [{ kind: "color", prompt: "Colour" }],
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
	{
		id: "align",
		name: "Align…",
		aliases: ["align", "alignment", "centre", "center"],
		icon: "align-center",
		arguments: [{ kind: "align", prompt: "Alignment" }],
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
];

/** Fast lookup for the executor. */
export const ACTIONS_BY_ID: ReadonlyMap<string, ActionDef> = new Map(
	ACTIONS.map((action) => [action.id, action]),
);

// ---------------------------------------------------------------------- flow

/**
 * The multi-step machinery, kept pure so the whole flow is unit-testable
 * without an App: which picker comes next, whether the bar closes afterwards,
 * and what ⌘P / ↑ do to the stored lists.
 */

/**
 * Actions that leave the bar open. Pinning and hiding are list-keeping, not
 * navigation — you do several in a row and then carry on searching, so closing
 * after each one would be the wrong shape. Everything else is a destination.
 */
const KEEP_OPEN: ReadonlySet<string> = new Set(["pin", "hide"]);

export function closesBar(actionId: string): boolean {
	return !KEEP_OPEN.has(actionId);
}

/**
 * The picker for the next argument, or null when everything is collected and
 * the action can run. `collected` is `collectedValues(state).length`, so the
 * flow needs no counter of its own — the page stack already is one.
 */
export function nextArgument(action: ActionDef, collected: number): ArgumentPicker | null {
	const args = action.arguments;
	if (args === undefined || collected >= args.length) return null;
	return args[collected] ?? null;
}

/** How many pages a flow will push in total. */
export function argumentCount(action: ActionDef): number {
	return action.arguments?.length ?? 0;
}

// ------------------------------------------------------------------- pins

/**
 * Toggle an id in the pin list.
 *
 * Keyed by item id, never by a bare path: the ranker looks the pin up by id,
 * so a pin written under any other key would be stored, renamed along with
 * the file, and never once read. `fileItemId()` is what mints that id for
 * files, which is why the two must agree.
 *
 * Stored under `frecencyKeyFor(id)`, the same key frecency uses: a note found
 * through its text is the same note as the one found through its title, and
 * pinning either must pin both. Unpinning drops both spellings, so a pin
 * written under the raw full-text id by an earlier version goes too.
 */
export function togglePinned(pins: readonly string[], id: string): string[] {
	const key = frecencyKeyFor(id);
	return isPinned(pins, id)
		? pins.filter((entry) => entry !== id && entry !== key)
		: [...pins, key];
}

export function isPinned(pins: readonly string[], id: string): boolean {
	return pins.includes(id) || pins.includes(frecencyKeyFor(id));
}

/** Item-id prefixes whose remainder starts with a vault path. */
const PATH_PIN_PREFIXES = ["file:", "fulltext:", "folder:", "heading:", "block:"] as const;

/**
 * Follow a rename (`to` set) or a delete (`to` null) through the pin list.
 * Null when nothing changed, so the caller writes data.json only when it must.
 *
 * Covers every id that carries a path — files, full-text hits, folders,
 * headings (`heading:path:line`) and blocks (`block:path:id`) — and everything
 * inside a renamed or deleted folder. Vault paths cannot contain ":", so the
 * path of a heading or block id ends at its last colon.
 */
export function remapPins(
	pins: readonly string[],
	from: string,
	to: string | null,
): string[] | null {
	let changed = false;
	const out: string[] = [];
	for (const pin of pins) {
		const prefix = PATH_PIN_PREFIXES.find((candidate) => pin.startsWith(candidate));
		const rest = prefix === undefined ? "" : pin.slice(prefix.length);
		const hasSuffix = prefix === "heading:" || prefix === "block:";
		const cut = hasSuffix ? rest.lastIndexOf(":") : rest.length;
		const path = cut < 0 ? rest : rest.slice(0, cut);
		const inside = path === from || path.startsWith(`${from}/`);
		if (prefix === undefined || from.length === 0 || !inside) {
			out.push(pin);
			continue;
		}
		changed = true;
		if (to === null) continue;
		out.push(`${prefix}${to}${path.slice(from.length)}${rest.slice(path.length)}`);
	}
	return changed ? out : null;
}

// ------------------------------------------------------------------ hiding

/** Toggle a COMMAND id (not an item id) in the hidden list. */
export function toggleHidden(hidden: readonly string[], commandId: string): string[] {
	return hidden.includes(commandId)
		? hidden.filter((entry) => entry !== commandId)
		: [...hidden, commandId];
}

/**
 * Is this row one the user hid from the bar? Only commands can be hidden, and
 * the list stores the raw command id — the id Obsidian knows it by, so the
 * setting survives Barosaurus changing how it namespaces its own item ids.
 */
export function isHiddenItem(item: OmniItem, hidden: ReadonlySet<string>): boolean {
	return item.kind === "command" && hidden.has(item.commandId);
}

/** Drop hidden rows before ranking. Empty set → the very same array. */
export function withoutHidden<T extends { item: OmniItem }>(
	candidates: readonly T[],
	hidden: ReadonlySet<string>,
): readonly T[] {
	if (hidden.size === 0) return candidates;
	return candidates.filter((candidate) => !isHiddenItem(candidate.item, hidden));
}

// ----------------------------------------------------------------- history

/**
 * Where ↑ and ↓ land in the query history. `-1` means "not browsing" — the
 * live input, not a recalled entry — so the walk always starts and ends there
 * rather than at an off-by-one entry the user never typed.
 */
export function historyStep(length: number, index: number, direction: 1 | -1): number {
	if (length <= 0) return -1;
	const next = index + direction;
	if (next < 0) return -1;
	return Math.min(next, length - 1);
}

/** The text an index stands for; `-1` is the empty input the walk started from. */
export function historyQuery(history: readonly string[], index: number): string {
	if (index < 0) return "";
	return history[index] ?? "";
}
