import type { ActionDef, OmniItem } from "./types";

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
		aliases: ["ausführen", "run", "execute"],
		icon: "play",
		shortcut: "↵",
		appliesTo: (item) => item.kind === "command" || item.kind === "action",
	},
	{
		id: "open",
		name: "Open",
		aliases: ["öffnen", "open"],
		icon: "file-text",
		shortcut: "↵",
		appliesTo: (item) => isFileLike(item) || item.kind === "folder" || item.kind === "tab",
	},
	{
		id: "create-note",
		name: "Create note",
		aliases: ["notiz erstellen", "neue notiz", "create", "new note"],
		icon: "file-plus",
		shortcut: "↵",
		appliesTo: (item) => item.kind === "create" || item.kind === "ghost",
	},

	// ---------------------------------------------------------- opening
	{
		id: "open-new-tab",
		name: "Open in new tab",
		aliases: ["neuer tab", "new tab"],
		icon: "plus",
		shortcut: "⌘↵",
		appliesTo: (item) => isFileLike(item),
	},
	{
		id: "open-split",
		name: "Open to the right",
		aliases: ["rechts öffnen", "split", "teilen"],
		icon: "separator-vertical",
		shortcut: "⌘⌥↵",
		appliesTo: (item) => isFileLike(item),
	},
	{
		id: "open-window",
		name: "Open in new window",
		aliases: ["neues fenster", "new window", "popout"],
		icon: "picture-in-picture-2",
		shortcut: "⌘⌥⇧↵",
		appliesTo: (item) => isFileLike(item),
	},

	// ---------------------------------------------------------- linking
	{
		id: "insert-link",
		name: "Insert link at cursor",
		aliases: ["link einfügen", "insert link", "verlinken"],
		icon: "link",
		shortcut: "⇥",
		appliesTo: (item, ctx) => ctx.hasEditor && isFileLike(item),
	},
	{
		id: "copy-link",
		name: "Copy link",
		aliases: ["link kopieren", "copy link"],
		icon: "copy",
		shortcut: "⌘C",
		appliesTo: (item) => isFileLike(item),
	},
	{
		id: "copy-uri",
		name: "Copy Obsidian URI",
		aliases: ["uri kopieren", "obsidian url", "copy uri", "deep link"],
		icon: "external-link",
		appliesTo: (item) => hasPath(item),
	},

	// ---------------------------------------------------------- file ops
	{
		id: "rename",
		name: "Rename…",
		aliases: ["umbenennen", "rename"],
		icon: "pencil",
		arguments: [{ kind: "text", prompt: "New name", placeholder: "Name" }],
		appliesTo: (item) => item.kind === "file" || item.kind === "folder",
	},
	{
		id: "move",
		name: "Move to…",
		aliases: ["verschieben", "move", "ordner wechseln"],
		icon: "folder-input",
		arguments: [{ kind: "folder", prompt: "Move to folder" }],
		appliesTo: (item) => item.kind === "file" || item.kind === "folder",
	},
	{
		id: "add-tag",
		name: "Add tag…",
		aliases: ["tag hinzufügen", "schlagwort", "add tag"],
		icon: "hash",
		arguments: [{ kind: "tag", prompt: "Tag" }],
		appliesTo: (item) => item.kind === "file",
	},
	{
		id: "bookmark",
		name: "Bookmark",
		aliases: ["lesezeichen", "bookmark", "merken"],
		icon: "bookmark",
		requiresCorePlugin: "bookmarks",
		appliesTo: (item) => isFileLike(item) || item.kind === "folder",
	},
	{
		id: "append-daily",
		name: "Append to daily note",
		aliases: ["an tagesnotiz anhängen", "daily note", "journal"],
		icon: "calendar-plus",
		requiresCorePlugin: "daily-notes",
		appliesTo: (item) => isFileLike(item),
	},
	{
		id: "reveal-explorer",
		name: "Show in file explorer",
		aliases: ["im explorer zeigen", "reveal", "dateibaum"],
		icon: "folder-tree",
		requiresCorePlugin: "file-explorer",
		appliesTo: (item) => hasPath(item),
	},
	{
		id: "reveal-system",
		name: "Show in system folder",
		aliases: ["im finder zeigen", "im ordner zeigen", "finder", "explorer", "system"],
		icon: "external-link",
		appliesTo: (item) => hasPath(item),
	},
	{
		id: "delete",
		name: "Delete",
		aliases: ["löschen", "delete", "papierkorb", "trash"],
		icon: "trash-2",
		appliesTo: (item) => item.kind === "file" || item.kind === "folder",
	},

	// ---------------------------------------------------------- commands
	{
		id: "assign-hotkey",
		name: "Assign hotkey…",
		aliases: ["tastenkürzel", "hotkey", "shortcut zuweisen"],
		icon: "keyboard",
		appliesTo: (item) => item.kind === "command",
	},
	{
		id: "pin",
		name: "Pin",
		aliases: ["anheften", "pin", "oben halten"],
		icon: "pin",
		shortcut: "⌘P",
		appliesTo: () => true,
	},
	{
		id: "hide",
		name: "Hide from this bar",
		aliases: ["ausblenden", "hide", "verstecken"],
		icon: "eye-off",
		appliesTo: (item) => item.kind === "command",
	},
	{
		id: "run-command-on",
		name: "Run any command on this…",
		aliases: ["befehl anwenden", "run command", "befehl ausführen auf"],
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
		aliases: ["in neue notiz auslagern", "extract", "auslagern", "herauslösen"],
		icon: "file-output",
		arguments: [{ kind: "text", prompt: "Note title", placeholder: "Title" }],
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
	{
		id: "wrap-callout",
		name: "Wrap in callout…",
		aliases: ["als callout", "in hinweis umwandeln", "callout", "box"],
		icon: "quote",
		arguments: [{ kind: "text", prompt: "Callout type", placeholder: "note, warning, tip…" }],
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
	{
		id: "to-task",
		name: "Turn into task list",
		aliases: ["in aufgaben umwandeln", "todo", "aufgabenliste", "task list", "checkliste"],
		icon: "list-checks",
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
	{
		id: "to-bullets",
		name: "Turn into bullet points",
		aliases: ["in stichpunkte umwandeln", "stichpunkte", "aufzählung", "bullets"],
		icon: "list",
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
	{
		id: "to-quote",
		name: "Turn into quote",
		aliases: ["in zitat umwandeln", "zitat", "quote", "blockquote"],
		icon: "text-quote",
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
	{
		id: "link-from-selection",
		name: "Create link from selection",
		aliases: ["link aus auswahl", "verlinken", "create link", "zu notiz machen"],
		icon: "link-2",
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
	{
		id: "text-color",
		name: "Text colour…",
		aliases: ["schriftfarbe", "farbe", "text colour", "text color", "einfärben"],
		icon: "palette",
		arguments: [{ kind: "color", prompt: "Colour" }],
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
	{
		id: "background-color",
		name: "Highlight colour…",
		aliases: ["hintergrundfarbe", "markierungsfarbe", "background colour", "highlight"],
		icon: "highlighter",
		arguments: [{ kind: "color", prompt: "Colour" }],
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
	{
		id: "align",
		name: "Align…",
		aliases: ["ausrichten", "ausrichtung", "align", "zentrieren"],
		icon: "align-center",
		arguments: [{ kind: "align", prompt: "Alignment" }],
		appliesTo: (_item, ctx) => ctx.selection.length > 0 && ctx.hasEditor,
	},
];

/** Fast lookup for the executor. */
export const ACTIONS_BY_ID: ReadonlyMap<string, ActionDef> = new Map(
	ACTIONS.map((action) => [action.id, action]),
);
