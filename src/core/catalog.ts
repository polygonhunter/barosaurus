import type { BlockDef, UserSnippet } from "./blocks";
import { fold } from "./normalize";
import type { TileSpec } from "./types";

/**
 * The curated layer.
 *
 * Barosaurus lists EVERY registered command automatically — that is layer one
 * and it needs no catalog. This is layer two: a small table that gives the
 * commands people actually reach for a better name, an icon, extra match terms,
 * and the situation tags the context ranker reads.
 *
 * Why it is worth the table: Obsidian names the bold command "Toggle bold".
 * Typing "b" does not prefix-match that, so the single most common formatting
 * action loses to every note in the vault that happens to start with b. Renamed
 * to "Bold", it lands on tier 0. The command still executes through
 * executeCommandById — we rename the door, not the room.
 *
 * Aliases are English only. They are match terms for every user, so a
 * second-language synonym is not a free addition: it competes in the ranking
 * for people who cannot read it.
 *
 * Every commandId here was read out of a real plugin's source, not guessed.
 */

export interface CuratedCommand {
	/** The real command id passed to executeCommandById. */
	commandId: string;
	/** Sentence case, like the rest of the UI. */
	name: string;
	/** Extra match terms, English only; fold() normalizes both sides. */
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
		aliases: ["bold", "strong", "toggle bold"],
		icon: "bold",
		contextTags: FORMAT,
	},
	{
		commandId: "editor:toggle-italics",
		name: "Italic",
		aliases: ["italic", "italics", "emphasis", "toggle italics"],
		icon: "italic",
		contextTags: FORMAT,
	},
	{
		commandId: "editor:toggle-highlight",
		name: "Highlight",
		aliases: ["highlight", "mark", "marker"],
		icon: "highlighter",
		contextTags: FORMAT,
	},
	{
		commandId: "editor:toggle-strikethrough",
		name: "Strikethrough",
		aliases: ["strikethrough", "strike", "strikeout"],
		icon: "strikethrough",
		contextTags: FORMAT,
	},
	{
		commandId: "editor:toggle-code",
		name: "Inline code",
		aliases: ["code", "monospace", "inline code"],
		icon: "code",
		tile: { kind: "mono", sample: "code" },
		contextTags: FORMAT,
	},
	{
		commandId: "editor:toggle-blockquote",
		name: "Quote",
		aliases: ["quote", "blockquote", "cite"],
		icon: "text-quote",
		tile: { kind: "quote" },
		contextTags: FORMAT,
	},
	{
		commandId: "editor:toggle-comments",
		name: "Comment",
		aliases: ["comment", "hide", "hidden"],
		icon: "message-square",
		contextTags: FORMAT,
	},
	{
		commandId: "editor:clear-formatting",
		name: "Clear formatting",
		aliases: ["clear formatting", "remove formatting", "reset", "eraser"],
		icon: "eraser",
		contextTags: FORMAT,
	},
];

/** Headings. The "h2" alias matters: it turns an acronym hit into an exact one. */
const HEADINGS: CuratedCommand[] = ([1, 2, 3, 4, 5, 6] as const).map((level) => ({
	commandId: `editor:set-heading-${level}`,
	name: `Heading ${level}`,
	aliases: [`h${level}`, `heading ${level}`, `title ${level}`],
	icon: `heading-${level}`,
	tile: { kind: "heading", level },
	contextTags: FORMAT,
}));

const LISTS: CuratedCommand[] = [
	{
		commandId: "editor:toggle-bullet-list",
		name: "Bullet list",
		aliases: ["bullet", "bullet list", "ul", "unordered list"],
		icon: "list",
		tile: { kind: "list", marker: "bullet" },
		contextTags: FORMAT,
	},
	{
		commandId: "editor:toggle-numbered-list",
		name: "Numbered list",
		aliases: ["numbered", "numbered list", "ol", "ordered list"],
		icon: "list-ordered",
		tile: { kind: "list", marker: "number" },
		contextTags: FORMAT,
	},
	{
		commandId: "editor:toggle-checklist-status",
		name: "Task",
		aliases: ["todo", "task", "checkbox", "checklist"],
		icon: "list-checks",
		tile: { kind: "list", marker: "check" },
		contextTags: FORMAT,
	},
	{
		commandId: "editor:cycle-list-checklist",
		name: "Cycle list type",
		aliases: ["cycle list", "switch list type"],
		icon: "list-restart",
		contextTags: FORMAT,
	},
	{
		commandId: "editor:indent-list",
		name: "Indent",
		aliases: ["indent"],
		icon: "indent",
		contextTags: EDITOR,
	},
	{
		commandId: "editor:unindent-list",
		name: "Outdent",
		aliases: ["outdent", "unindent"],
		icon: "outdent",
		contextTags: EDITOR,
	},
];

const INSERT: CuratedCommand[] = [
	{
		commandId: "editor:insert-callout",
		name: "Callout",
		aliases: ["callout", "admonition", "box", "infobox"],
		icon: "quote",
		tile: { kind: "callout", calloutType: "note" },
		contextTags: FORMAT,
	},
	{
		commandId: "editor:insert-table",
		name: "Table",
		aliases: ["table", "grid"],
		icon: "table",
		tile: { kind: "table" },
		contextTags: EDITOR,
	},
	{
		commandId: "editor:insert-link",
		name: "Link",
		aliases: ["link", "url", "markdown link"],
		icon: "link",
		contextTags: FORMAT,
	},
	{
		commandId: "editor:insert-wikilink",
		name: "Internal link",
		aliases: ["wikilink", "internal link", "link note"],
		icon: "brackets",
		contextTags: FORMAT,
	},
	{
		commandId: "editor:insert-embed",
		name: "Embed",
		aliases: ["embed", "transclusion", "include"],
		icon: "file-input",
		contextTags: EDITOR,
	},
	{
		commandId: "editor:insert-mathblock",
		name: "Math block",
		aliases: ["latex", "math", "equation", "formula"],
		icon: "sigma",
		contextTags: EDITOR,
	},
	{
		commandId: "editor:insert-tag",
		name: "Tag",
		aliases: ["tag", "hashtag"],
		icon: "hash",
		contextTags: EDITOR,
	},
	{
		commandId: "editor:attach-file",
		name: "Attach file",
		aliases: ["attach", "attachment", "file"],
		icon: "paperclip",
		contextTags: EDITOR,
	},
];

const EDITING: CuratedCommand[] = [
	{
		commandId: "editor:undo",
		name: "Undo",
		aliases: ["undo", "revert"],
		icon: "undo-2",
		contextTags: EDITOR,
	},
	{
		commandId: "editor:redo",
		name: "Redo",
		aliases: ["redo"],
		icon: "redo-2",
		contextTags: EDITOR,
	},
	{
		commandId: "editor:swap-line-up",
		name: "Move line up",
		aliases: ["move up", "swap line up", "line up"],
		icon: "arrow-up",
		contextTags: EDITOR,
	},
	{
		commandId: "editor:swap-line-down",
		name: "Move line down",
		aliases: ["move down", "swap line down", "line down"],
		icon: "arrow-down",
		contextTags: EDITOR,
	},
	{
		commandId: "editor:focus",
		name: "Focus editor",
		aliases: ["focus", "focus editor"],
		icon: "text-cursor-input",
		contextTags: EDITOR,
	},
];

const VIEW: CuratedCommand[] = [
	{
		commandId: "app:toggle-left-sidebar",
		name: "Toggle left sidebar",
		aliases: ["left sidebar", "sidebar left"],
		icon: "panel-left",
		contextTags: ["navigation"],
	},
	{
		commandId: "app:toggle-right-sidebar",
		name: "Toggle right sidebar",
		aliases: ["right sidebar", "sidebar right"],
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
		aliases: ["search", "searchosaurus", "spotlight", "full text"],
		icon: "search",
		contextTags: ["navigation"],
		requiresPlugin: "searchosaurus",
	},
	{
		commandId: "autolink-keywords:link-and-add-keyword",
		name: "Link selection and add keyword",
		aliases: ["linkosaurus", "keyword", "link"],
		icon: "link-2",
		contextTags: ["selection", "editor"],
		requiresPlugin: "autolink-keywords",
	},
	{
		commandId: "autolink-keywords:autolink-current-note",
		name: "Auto-link this note",
		aliases: ["linkosaurus", "autolink", "auto link"],
		icon: "wand-2",
		contextTags: ["editor"],
		requiresPlugin: "autolink-keywords",
	},
	{
		commandId: "autolink-keywords:relink-all-notes",
		name: "Auto-link every note",
		aliases: ["linkosaurus", "relink", "relink all notes"],
		icon: "wand-sparkles",
		contextTags: ["vault"],
		requiresPlugin: "autolink-keywords",
	},
	{
		commandId: "daily-bible-verse:insert-todays-verse",
		name: "Insert today's Bible verse",
		aliases: ["bible", "verse", "bible verse"],
		icon: "book-open",
		contextTags: ["editor"],
		requiresPlugin: "daily-bible-verse",
	},
	{
		commandId: "daily-bible-verse:insert-verse-into-daily-note",
		name: "Insert Bible verse into today's daily note",
		aliases: ["bible", "verse", "daily note"],
		icon: "book-marked",
		contextTags: ["vault"],
		requiresPlugin: "daily-bible-verse",
	},
	{
		commandId: "daily-bible-verse:reroll-todays-verse",
		name: "Re-roll today's Bible verse",
		aliases: ["reroll", "reroll verse", "bible"],
		icon: "dices",
		contextTags: ["vault"],
		requiresPlugin: "daily-bible-verse",
	},
	{
		commandId: "daily-bible-verse:replace-bible-verse-placeholders",
		name: "Replace Bible verse placeholders",
		aliases: ["placeholder", "replace placeholders", "bible"],
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

// ============================================================ insert blocks

/**
 * Layer three: things the bar WRITES rather than runs.
 *
 * A curated command borrows a door that Obsidian already built. These entries
 * have no door — there is no "insert a warning callout" command anywhere in
 * Obsidian — so they carry their own template and the executor renders it
 * through `core/insert.ts`. They are surfaced as `kind: "action"` rows whose
 * `actionId` is `INSERT_ACTION_PREFIX + def.id`, the same shape the settings
 * and go-to-line sources already use.
 *
 * Every template is a `BlockDef`, so the selection handling (`core/wrap.ts`)
 * and the cursor arithmetic (`core/insert.ts`) are shared with everything else
 * that writes into a note, and the whole set stays unit-testable.
 */

/** The executor switches on this prefix; the remainder is the BlockDef id. */
export const INSERT_ACTION_PREFIX = "insert-block:";

export function blockActionId(blockId: string): string {
	return `${INSERT_ACTION_PREFIX}${blockId}`;
}

/** The BlockDef id inside an action id, or null when it is not one of ours. */
export function blockIdFromActionId(actionId: string): string | null {
	return actionId.startsWith(INSERT_ACTION_PREFIX)
		? actionId.slice(INSERT_ACTION_PREFIX.length)
		: null;
}

/**
 * The 13 callout types Obsidian ships with, in the order its own documentation
 * lists them. Aliases carry Obsidian's own official synonyms (`summary`,
 * `tldr`, `caution`…) plus the plain-English word someone would reach for when
 * they do not know the official one.
 */
export interface CalloutSpec {
	type: string;
	/** Sentence case, like every label in the bar. */
	label: string;
	aliases: readonly string[];
}

export const CALLOUT_TYPES: readonly CalloutSpec[] = [
	{ type: "note", label: "Note callout", aliases: ["note", "remark"] },
	{
		type: "abstract",
		label: "Abstract callout",
		aliases: ["summary", "tldr", "abstract"],
	},
	{ type: "info", label: "Info callout", aliases: ["information", "infobox"] },
	{ type: "todo", label: "Todo callout", aliases: ["task", "open", "pending"] },
	{ type: "tip", label: "Tip callout", aliases: ["hint", "important", "tip"] },
	{ type: "success", label: "Success callout", aliases: ["check", "done", "success"] },
	{ type: "question", label: "Question callout", aliases: ["help", "faq", "question"] },
	{
		type: "warning",
		label: "Warning callout",
		aliases: ["caution", "attention", "warning"],
	},
	{
		type: "failure",
		label: "Failure callout",
		aliases: ["fail", "missing", "failure"],
	},
	{ type: "danger", label: "Danger callout", aliases: ["error", "danger"] },
	{ type: "bug", label: "Bug callout", aliases: ["defect", "issue"] },
	{ type: "example", label: "Example callout", aliases: ["example", "sample"] },
	{ type: "quote", label: "Quote callout", aliases: ["cite", "quotation"] },
];

/** Fenced-code languages offered by the second stage of the code-block flow. */
export const CODE_LANGUAGES: readonly string[] = [
	"javascript",
	"typescript",
	"python",
	"java",
	"c",
	"cpp",
	"csharp",
	"go",
	"rust",
	"swift",
	"kotlin",
	"ruby",
	"php",
	"bash",
	"shell",
	"powershell",
	"sql",
	"html",
	"css",
	"scss",
	"json",
	"yaml",
	"toml",
	"xml",
	"markdown",
	"latex",
	"r",
	"lua",
	"perl",
	"haskell",
	"elixir",
	"scala",
	"dart",
	"dockerfile",
	"ini",
	"diff",
	"mermaid",
	"plaintext",
];

/**
 * All of these land in the "actions" group: they are things the bar does, not
 * commands it forwards, and the group already leads GROUP_ORDER.
 */
function calloutBlock(spec: CalloutSpec): BlockDef {
	return {
		id: `callout-${spec.type}`,
		name: spec.label,
		aliases: ["callout", "box", spec.type, ...spec.aliases],
		group: "actions",
		// {fold} becomes "-" when the user asked for a folded callout.
		template: `> [!${spec.type}]{fold}\n> {cursor}`,
		wrap: "prefixLines",
		linePrefix: "> ",
		tile: { kind: "callout", calloutType: spec.type },
		foldable: true,
	};
}

/** The date entry. `{date}` is filled from the user's own format string. */
const DATE_BLOCK: BlockDef = {
	id: "date",
	name: "Insert today's date",
	aliases: ["date", "today", "now", "current date"],
	group: "actions",
	template: "{date}{cursor}",
	wrap: "none",
	tile: { kind: "icon", icon: "calendar" },
	special: "date",
};

const CODEBLOCK: BlockDef = {
	id: "codeblock",
	name: "Code block",
	aliases: ["codeblock", "code", "fence", "listing"],
	group: "actions",
	template: "```{lang}\n{cursor}\n```",
	wrap: "fenced",
	tile: { kind: "mono", sample: "{ }" },
	special: "codeblock",
};

const FOOTNOTE: BlockDef = {
	id: "footnote",
	name: "Footnote",
	aliases: ["footnote", "reference", "note"],
	group: "actions",
	// Empty on purpose: a footnote is two edits (marker here, definition at the
	// end of the document), so it is planned rather than templated.
	template: "",
	wrap: "none",
	tile: { kind: "icon", icon: "superscript" },
	special: "footnote",
};

const HORIZONTAL_RULE: BlockDef = {
	id: "horizontal-rule",
	name: "Horizontal rule",
	aliases: ["hr", "rule", "divider", "separator", "horizontal rule"],
	group: "actions",
	template: "\n---\n{cursor}",
	wrap: "none",
	tile: { kind: "divider" },
};

/** Everything the bar can write without asking the user to configure it. */
export const INSERT_BLOCKS: readonly BlockDef[] = [
	DATE_BLOCK,
	...CALLOUT_TYPES.map(calloutBlock),
	CODEBLOCK,
	FOOTNOTE,
	HORIZONTAL_RULE,
];

/**
 * The user's own snippets as catalog entries.
 *
 * The id is derived from the NAME rather than the array index, because the id
 * is also the frecency key and the pin key: reordering the list in the
 * settings tab must not hand one snippet another one's history. A name that
 * folds to nothing (or collides) falls back to its position, which is stable
 * enough for something that cannot be told apart in the list anyway.
 */
export function snippetBlocks(snippets: readonly UserSnippet[]): BlockDef[] {
	const used = new Set<string>();
	const blocks: BlockDef[] = [];
	snippets.forEach((snippet, index) => {
		const name = snippet.name.trim();
		if (name.length === 0 || snippet.template.length === 0) return;
		const folded = fold(name).replace(/\s+/g, "-");
		const base = folded.length > 0 ? folded : String(index);
		const id = used.has(`snippet:${base}`) ? `snippet:${base}-${index}` : `snippet:${base}`;
		used.add(id);
		blocks.push({
			id,
			name,
			aliases: ["snippet", "template", "block"],
			group: "actions",
			// A template without {cursor} still works — the cursor lands at the end.
			template: snippet.template,
			wrap: "inline",
			tile: { kind: "icon", icon: "scissors" },
		});
	});
	return blocks;
}

/** Built-ins plus the user's snippets — what a source should enumerate. */
export function insertBlocks(snippets: readonly UserSnippet[] = []): BlockDef[] {
	return [...INSERT_BLOCKS, ...snippetBlocks(snippets)];
}

/** Resolve a BlockDef id back to its definition. Null when it is gone. */
export function findInsertBlock(
	blockId: string,
	snippets: readonly UserSnippet[] = [],
): BlockDef | null {
	return insertBlocks(snippets).find((def) => def.id === blockId) ?? null;
}

/**
 * Help & feedback — the ONLY outbound links in the whole plugin, and only ever
 * on an explicit pick. Nothing here runs in the background; see the privacy
 * section of the README.
 *
 * The parameters let a report arrive with the context that otherwise takes
 * three follow-up questions to establish.
 */
const SUPPORT_BASE_URL = "https://polygonhunter.com/";
const SUPPORT_ANCHOR = "#kontakt";

/** What a bug report should carry without the reporter having to look it up. */
export interface SupportInfo {
	pluginVersion: string;
	obsidianVersion: string;
	platform: string;
}

export function supportUrl(info: SupportInfo): string {
	const params = new URLSearchParams({
		plugin: "barosaurus",
		version: info.pluginVersion,
		obsidianVersion: info.obsidianVersion,
		platform: info.platform,
	});
	return `${SUPPORT_BASE_URL}?${params.toString()}${SUPPORT_ANCHOR}`;
}

/** The issue tracker. Public, and the right place for anything reproducible. */
export const ISSUES_URL = "https://github.com/polygonhunter/barosaurus/issues";

/**
 * The two action ids the dispatcher switches on.
 *
 * Named constants rather than inline strings because three files have to agree
 * on them — the catalog that mints the entry, `runAction` that executes it, and
 * the source that puts it in the list — and a typo in any one of them produces
 * a row that looks perfectly fine and does nothing.
 */
export const SUPPORT_ACTION = "report-bug";
export const ISSUES_ACTION = "open-issues";

/** One row in the bar that leads out of the plugin. */
export interface HelpEntry {
	actionId: string;
	/** Sentence case, like every other label. */
	name: string;
	/** Extra match terms, English only — see the note at the top of this file. */
	aliases: string[];
	icon: string;
}

/**
 * Getting help, from the bar.
 *
 * Both destinations already existed — `supportUrl()` above and the issue
 * tracker in the README — and neither was reachable from the one place a
 * person actually looks when something is broken. The aliases are the words
 * someone types while annoyed, not the words we would have chosen for a menu.
 */
export const HELP_ENTRIES: readonly HelpEntry[] = [
	{
		actionId: SUPPORT_ACTION,
		name: "Report a bug or get in touch",
		aliases: [
			"bug",
			"support",
			"help",
			"feedback",
			"contact",
			"problem",
			"report",
			"broken",
			"not working",
			"get in touch",
		],
		icon: "life-buoy",
	},
	{
		actionId: ISSUES_ACTION,
		name: "Open an issue on GitHub",
		aliases: [
			"issue",
			"issues",
			"github",
			"bug",
			"report",
			"feature request",
			"tracker",
			"roadmap",
		],
		icon: "github",
	},
];
