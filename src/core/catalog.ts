import type { TileSpec } from "./types";

/**
 * The curated layer.
 *
 * Barosaurus lists EVERY registered command automatically — that is layer one
 * and it needs no catalog. This is layer two: a small table that gives the
 * commands people actually reach for a better name, an icon, German and
 * English aliases, and the situation tags the context ranker reads.
 *
 * Why it is worth the table: Obsidian names the bold command "Toggle bold".
 * Typing "b" does not prefix-match that, and typing "fett" matches nothing at
 * all. Renamed to "Bold" with the alias "fett", both land on tier 0 or 1. The
 * command still executes through executeCommandById — we rename the door, not
 * the room.
 *
 * Every commandId here was read out of a real plugin's source, not guessed.
 */

export interface CuratedCommand {
	/** The real command id passed to executeCommandById. */
	commandId: string;
	/** Sentence case, like the rest of the UI. */
	name: string;
	/** Extra match terms. DE and EN coexist; fold() handles the umlauts. */
	aliases: string[];
	/** Lucide icon name for setIcon. */
	icon: string;
	tile?: TileSpec;
	contextTags: readonly string[];
	/** Hidden unless this community plugin is enabled. */
	requiresPlugin?: string;
}

const FORMAT = ["formatting", "editor", "selection"] as const;
const EDITOR = ["editor"] as const;

/** Text formatting — the Editing Toolbar parity set, all built in. */
const FORMATTING: CuratedCommand[] = [
	{
		commandId: "editor:toggle-bold",
		name: "Bold",
		aliases: ["fett", "bold", "strong", "toggle bold"],
		icon: "bold",
		contextTags: FORMAT,
	},
	{
		commandId: "editor:toggle-italics",
		name: "Italic",
		aliases: ["kursiv", "italic", "emphasis", "toggle italics"],
		icon: "italic",
		contextTags: FORMAT,
	},
	{
		commandId: "editor:toggle-highlight",
		name: "Highlight",
		aliases: ["markieren", "hervorheben", "highlight", "marker"],
		icon: "highlighter",
		contextTags: FORMAT,
	},
	{
		commandId: "editor:toggle-strikethrough",
		name: "Strikethrough",
		aliases: ["durchgestrichen", "durchstreichen", "strikethrough", "strike"],
		icon: "strikethrough",
		contextTags: FORMAT,
	},
	{
		commandId: "editor:toggle-code",
		name: "Inline code",
		aliases: ["code", "monospace", "quelltext"],
		icon: "code",
		tile: { kind: "mono", sample: "code" },
		contextTags: FORMAT,
	},
	{
		commandId: "editor:toggle-blockquote",
		name: "Quote",
		aliases: ["zitat", "quote", "blockquote", "einrücken"],
		icon: "text-quote",
		tile: { kind: "quote" },
		contextTags: FORMAT,
	},
	{
		commandId: "editor:toggle-comments",
		name: "Comment",
		aliases: ["kommentar", "comment", "ausblenden"],
		icon: "message-square",
		contextTags: FORMAT,
	},
	{
		commandId: "editor:clear-formatting",
		name: "Clear formatting",
		aliases: ["formatierung entfernen", "zurücksetzen", "clear formatting", "eraser"],
		icon: "eraser",
		contextTags: FORMAT,
	},
];

/** Headings. The "h2" alias matters: it turns an acronym hit into an exact one. */
const HEADINGS: CuratedCommand[] = ([1, 2, 3, 4, 5, 6] as const).map((level) => ({
	commandId: `editor:set-heading-${level}`,
	name: `Heading ${level}`,
	aliases: [`h${level}`, `überschrift ${level}`, `titel ${level}`, `heading ${level}`],
	icon: `heading-${level}`,
	tile: { kind: "heading", level } as TileSpec,
	contextTags: FORMAT,
}));

const LISTS: CuratedCommand[] = [
	{
		commandId: "editor:toggle-bullet-list",
		name: "Bullet list",
		aliases: ["liste", "aufzählung", "bullet", "ul", "unordered list"],
		icon: "list",
		tile: { kind: "list", marker: "bullet" },
		contextTags: FORMAT,
	},
	{
		commandId: "editor:toggle-numbered-list",
		name: "Numbered list",
		aliases: ["nummerierte liste", "numbered", "ol", "ordered list"],
		icon: "list-ordered",
		tile: { kind: "list", marker: "number" },
		contextTags: FORMAT,
	},
	{
		commandId: "editor:toggle-checklist-status",
		name: "Task",
		aliases: ["aufgabe", "todo", "task", "checkbox", "checkliste", "checklist"],
		icon: "list-checks",
		tile: { kind: "list", marker: "check" },
		contextTags: FORMAT,
	},
	{
		commandId: "editor:cycle-list-checklist",
		name: "Cycle list type",
		aliases: ["listentyp wechseln", "cycle list"],
		icon: "list-restart",
		contextTags: FORMAT,
	},
	{
		commandId: "editor:indent-list",
		name: "Indent",
		aliases: ["einrücken", "indent", "tiefer"],
		icon: "indent",
		contextTags: EDITOR,
	},
	{
		commandId: "editor:unindent-list",
		name: "Outdent",
		aliases: ["ausrücken", "outdent", "unindent", "höher"],
		icon: "outdent",
		contextTags: EDITOR,
	},
];

const INSERT: CuratedCommand[] = [
	{
		commandId: "editor:insert-callout",
		name: "Callout",
		aliases: ["hinweis", "callout", "admonition", "box", "infobox"],
		icon: "quote",
		tile: { kind: "callout", calloutType: "note" },
		contextTags: FORMAT,
	},
	{
		commandId: "editor:insert-table",
		name: "Table",
		aliases: ["tabelle", "table", "grid"],
		icon: "table",
		tile: { kind: "table" },
		contextTags: EDITOR,
	},
	{
		commandId: "editor:insert-link",
		name: "Link",
		aliases: ["link", "url", "verknüpfung", "markdown link"],
		icon: "link",
		contextTags: FORMAT,
	},
	{
		commandId: "editor:insert-wikilink",
		name: "Internal link",
		aliases: ["interner link", "wikilink", "notiz verlinken", "verlinken"],
		icon: "brackets",
		contextTags: FORMAT,
	},
	{
		commandId: "editor:insert-embed",
		name: "Embed",
		aliases: ["einbetten", "embed", "transklusion", "transclusion"],
		icon: "file-input",
		contextTags: EDITOR,
	},
	{
		commandId: "editor:insert-mathblock",
		name: "Math block",
		aliases: ["formel", "mathe", "latex", "math", "equation"],
		icon: "sigma",
		contextTags: EDITOR,
	},
	{
		commandId: "editor:insert-tag",
		name: "Tag",
		aliases: ["schlagwort", "tag", "hashtag"],
		icon: "hash",
		contextTags: EDITOR,
	},
	{
		commandId: "editor:attach-file",
		name: "Attach file",
		aliases: ["datei anhängen", "anhang", "attach", "attachment"],
		icon: "paperclip",
		contextTags: EDITOR,
	},
];

const EDITING: CuratedCommand[] = [
	{
		commandId: "editor:undo",
		name: "Undo",
		aliases: ["rückgängig", "undo", "zurück"],
		icon: "undo-2",
		contextTags: EDITOR,
	},
	{
		commandId: "editor:redo",
		name: "Redo",
		aliases: ["wiederholen", "redo", "vorwärts"],
		icon: "redo-2",
		contextTags: EDITOR,
	},
	{
		commandId: "editor:swap-line-up",
		name: "Move line up",
		aliases: ["zeile hoch", "move up", "swap line up"],
		icon: "arrow-up",
		contextTags: EDITOR,
	},
	{
		commandId: "editor:swap-line-down",
		name: "Move line down",
		aliases: ["zeile runter", "move down", "swap line down"],
		icon: "arrow-down",
		contextTags: EDITOR,
	},
	{
		commandId: "editor:focus",
		name: "Focus editor",
		aliases: ["fokus", "focus", "editor fokussieren"],
		icon: "text-cursor-input",
		contextTags: EDITOR,
	},
];

const VIEW: CuratedCommand[] = [
	{
		commandId: "app:toggle-left-sidebar",
		name: "Toggle left sidebar",
		aliases: ["linke seitenleiste", "left sidebar", "sidebar links"],
		icon: "panel-left",
		contextTags: ["navigation"],
	},
	{
		commandId: "app:toggle-right-sidebar",
		name: "Toggle right sidebar",
		aliases: ["rechte seitenleiste", "right sidebar", "sidebar rechts"],
		icon: "panel-right",
		contextTags: ["navigation"],
	},
];

/**
 * The -osaurus family. Every id below was verified against the plugin's own
 * source, and every entry is gated: a group whose entries all vanish leaves no
 * overline label and no dead rows.
 *
 * Linkosaurus registers under the plugin id `autolink-keywords`, NOT
 * `linkosaurus` — that mismatch silently breaks the gate if you guess.
 */
export const FAMILY_COMMANDS: CuratedCommand[] = [
	{
		commandId: "searchosaurus:open-search",
		name: "Search your vault",
		aliases: ["suche", "searchosaurus", "spotlight", "volltext"],
		icon: "search",
		contextTags: ["navigation"],
		requiresPlugin: "searchosaurus",
	},
	{
		commandId: "autolink-keywords:link-and-add-keyword",
		name: "Link selection and add keyword",
		aliases: ["linkosaurus", "keyword", "schlüsselwort", "verlinken"],
		icon: "link-2",
		contextTags: ["selection", "editor"],
		requiresPlugin: "autolink-keywords",
	},
	{
		commandId: "autolink-keywords:autolink-current-note",
		name: "Auto-link this note",
		aliases: ["linkosaurus", "autolink", "automatisch verlinken"],
		icon: "wand-2",
		contextTags: ["editor"],
		requiresPlugin: "autolink-keywords",
	},
	{
		commandId: "autolink-keywords:relink-all-notes",
		name: "Auto-link every note",
		aliases: ["linkosaurus", "relink", "alle notizen verlinken"],
		icon: "wand-sparkles",
		contextTags: ["vault"],
		requiresPlugin: "autolink-keywords",
	},
	{
		commandId: "daily-bible-verse:insert-todays-verse",
		name: "Insert today's Bible verse",
		aliases: ["bibelvers", "vers", "bible", "verse", "losung"],
		icon: "book-open",
		contextTags: ["editor"],
		requiresPlugin: "daily-bible-verse",
	},
	{
		commandId: "daily-bible-verse:insert-verse-into-daily-note",
		name: "Insert Bible verse into today's daily note",
		aliases: ["bibelvers", "daily note", "tagesnotiz", "vers"],
		icon: "book-marked",
		contextTags: ["vault"],
		requiresPlugin: "daily-bible-verse",
	},
	{
		commandId: "daily-bible-verse:reroll-todays-verse",
		name: "Re-roll today's Bible verse",
		aliases: ["vers neu würfeln", "reroll", "bibelvers", "würfeln"],
		icon: "dices",
		contextTags: ["vault"],
		requiresPlugin: "daily-bible-verse",
	},
	{
		commandId: "daily-bible-verse:replace-bible-verse-placeholders",
		name: "Replace Bible verse placeholders",
		aliases: ["platzhalter", "placeholder", "bibelvers"],
		icon: "replace",
		contextTags: ["editor"],
		requiresPlugin: "daily-bible-verse",
	},
];

/** Everything that overlays a real, already-registered command. */
export const CURATED_COMMANDS: readonly CuratedCommand[] = [
	...FORMATTING,
	...HEADINGS,
	...LISTS,
	...INSERT,
	...EDITING,
	...VIEW,
	...FAMILY_COMMANDS,
];

/** Fast lookup when decorating the enumerated command list. */
export const CURATED_BY_ID: ReadonlyMap<string, CuratedCommand> = new Map(
	CURATED_COMMANDS.map((entry) => [entry.commandId, entry]),
);

/**
 * Help & feedback — the ONE outbound link in the whole plugin, and only ever
 * on an explicit click. Nothing here runs in the background; see the privacy
 * section of the README.
 *
 * The parameters let a report arrive with the context that otherwise takes
 * three follow-up questions to establish.
 */
const SUPPORT_BASE_URL = "https://polygonhunter.com/";
const SUPPORT_ANCHOR = "#kontakt";

export function supportUrl(info: {
	pluginVersion: string;
	obsidianVersion: string;
	platform: string;
}): string {
	const params = new URLSearchParams({
		plugin: "barosaurus",
		version: info.pluginVersion,
		obsidianVersion: info.obsidianVersion,
		platform: info.platform,
	});
	return `${SUPPORT_BASE_URL}?${params.toString()}${SUPPORT_ANCHOR}`;
}
