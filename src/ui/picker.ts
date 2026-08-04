import { TFolder, type App } from "obsidian";
import { fold } from "../core/normalize";
import {
	ALIGNMENT_LABELS,
	COLOR_LABELS,
	COLOR_NAMES,
	type Alignment,
} from "../core/style";
import type { ArgumentPicker, OmniItem, TileSpec } from "../core/types";
import { fuzzyFactory, orderByMatch, type Scorable } from "../sources/files";
import { getAllVaultTags, listCommands } from "./unsafe";

/**
 * The argument pickers behind the multi-step flows.
 *
 * ## Why a page inside the bar rather than a second Modal
 *
 * Every picker here is a `BarPage`, not a Modal of its own. A stacked Modal
 * would take focus off the bar, get its own Esc handling, and need its own
 * list, matcher, pill and renderer — four copies of the surface the user
 * already has open. Pushing a page instead means one surface, one input, one
 * key layer, and `src/core/pagestack.ts` already owns the state machine that
 * makes Esc mean "back one level" and keeps the query typed at each level. The
 * breadcrumb pills come free with it.
 *
 * A page is deliberately dumb: given the typed query it returns rows, and when
 * one is chosen it hands a STRING back to the flow. It knows nothing about the
 * action it is collecting for, which is what keeps "Move to…" and a colour
 * swatch the same mechanism.
 */

// ---------------------------------------------------------------- the surface

/**
 * What a page may do to the bar it sits in. Implemented by the modal; passed
 * to pages so nothing here has to import the modal (and so the flow can be
 * driven by a fake in a test).
 */
export interface BarSurface {
	/** Push a level. `initialQuery` prefills the input — rename needs it. */
	pushPage(page: BarPage, initialQuery?: string): void;
	/** Pop a level. False at the root, where there is nothing left to pop. */
	popPage(): boolean;
	/** Record the value chosen at THIS level; it becomes the breadcrumb pill. */
	commit(value: string): void;
	/** Values collected so far, in push order — the action's arguments. */
	collected(): string[];
	/** Re-run the current level's query. */
	refresh(): void;
	close(): void;
}

/** One level of the bar: what it shows and what choosing a row there means. */
export interface BarPage {
	/** Discriminator stored in the page stack. */
	kind: string;
	/** Breadcrumb label, sentence case. */
	label: string;
	/** Input placeholder while this level is on top. */
	placeholder: string;
	/** Shown when `rows()` comes back empty. */
	emptyText: string;
	/** Rows for the typed query. Runs on every keystroke, so keep it cheap. */
	rows(query: string): OmniItem[];
	/** A row was chosen here. */
	choose(item: OmniItem, bar: BarSurface): void;
}

// ------------------------------------------------------------------ rows

/**
 * Picker rows are `kind: "action"` items — the same shape the settings-tab and
 * go-to-line sources already use for "a row that is not a vault object". That
 * buys the whole renderer (tile, title, subtitle, match highlighting, ⌘1–9)
 * without a second row type, and the union stays exhaustive.
 */
function valueRow(value: string, title: string, tile: TileSpec, subtitle?: string): OmniItem {
	const row: OmniItem = {
		id: `pick:${value}`,
		kind: "action",
		source: "command",
		group: "actions",
		title,
		aliases: [],
		tile,
		actionId: `pick:${value}`,
	};
	return subtitle === undefined || subtitle.length === 0 ? row : { ...row, subtitle };
}

/** The value a picker row carries. Rows are minted above, so this always fits. */
function valueOf(item: OmniItem): string | null {
	if (item.kind !== "action") return null;
	return item.actionId.startsWith("pick:") ? item.actionId.slice("pick:".length) : null;
}

/** Choosing a row commits its value and lets the flow decide what comes next. */
function commitRow(item: OmniItem, bar: BarSurface): void {
	const value = valueOf(item);
	if (value === null) return;
	bar.commit(value);
}

/** Fuzzy-order a list of rows by their own terms. Empty query keeps corpus order. */
function ordered(entries: Array<Scorable<OmniItem>>, query: string, limit: number): OmniItem[] {
	return orderByMatch(entries, fold(query), fuzzyFactory, limit);
}

/** Upper bound per picker page. Generous — a picker is a short list by nature. */
const PICKER_LIMIT = 100;

// ---------------------------------------------------------------- folders

/**
 * `vault.getAllLoadedFiles()` is public and already in memory, so the folder
 * list needs no traversal of its own. The vault root is included here (unlike
 * in the folders SOURCE, where it is never a useful destination) because
 * "move this to the top level" is a real answer.
 */
export function folderPage(prompt: string, app: App): BarPage {
	return {
		kind: "folder",
		label: prompt,
		placeholder: "Search folders…",
		emptyText: "No folder matches.",
		rows: (query) => folderRows(app, query),
		choose: commitRow,
	};
}

function folderRows(app: App, query: string): OmniItem[] {
	const entries: Array<Scorable<OmniItem>> = [];
	// The root has an empty path; show it under a name the user recognises.
	entries.push({
		value: valueRow("", "Vault root", { kind: "icon", icon: "folder-root" }, app.vault.getName()),
		terms: [fold("vault root"), fold(app.vault.getName())],
	});
	for (const entry of app.vault.getAllLoadedFiles()) {
		if (!(entry instanceof TFolder)) continue;
		if (entry.path === "/" || entry.path.length === 0) continue;
		entries.push({
			value: valueRow(entry.path, entry.name, { kind: "icon", icon: "folder" }, entry.path),
			terms: [fold(entry.name), fold(entry.path)].filter((term) => term.length > 0),
		});
	}
	return ordered(entries, query, PICKER_LIMIT);
}

// ------------------------------------------------------------------- tags

function tagRows(app: App, query: string): OmniItem[] {
	const entries: Array<Scorable<OmniItem>> = [];
	for (const { tag, count } of getAllVaultTags(app)) {
		// The stored form carries the '#'; the value handed to the action does
		// not, because frontmatter tags are written without it.
		const bare = tag.startsWith("#") ? tag.slice(1) : tag;
		entries.push({
			value: valueRow(
				bare,
				tag,
				{ kind: "icon", icon: "hash" },
				`${count} ${count === 1 ? "note" : "notes"}`,
			),
			terms: [fold(bare)],
		});
	}
	const rows = ordered(entries, query, PICKER_LIMIT);
	// A tag that does not exist yet is a perfectly good answer to "Add tag…".
	const typed = query.trim().replace(/^#/, "");
	if (typed.length > 0 && !rows.some((row) => valueOf(row) === typed)) {
		rows.unshift(valueRow(typed, `#${typed}`, { kind: "icon", icon: "plus" }, "New tag"));
	}
	return rows;
}

// ------------------------------------------------------------- properties

/**
 * Property keys already used anywhere in the vault, with a note count.
 *
 * Deliberately gathered by reading `frontmatter` off the metadata cache rather
 * than through `metadataCache.getAllPropertyInfos()`: that one is undocumented,
 * which makes it an API-floor question we cannot answer, and this is the same
 * read `src/sources/files.ts` already does for aliases. A miss costs a longer
 * list, never a wrong write.
 *
 * `position` is the cache's own bookkeeping, not a user property, so it goes.
 */
const NON_PROPERTY_KEYS: ReadonlySet<string> = new Set(["position"]);

export function vaultPropertyKeys(app: App): Array<{ key: string; count: number }> {
	const counts = new Map<string, number>();
	for (const file of app.vault.getMarkdownFiles()) {
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
		if (frontmatter === undefined || frontmatter === null) continue;
		for (const key of Object.keys(frontmatter)) {
			if (NON_PROPERTY_KEYS.has(key)) continue;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([key, count]) => ({ key, count }))
		.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function propertyRows(app: App, query: string): OmniItem[] {
	const entries: Array<Scorable<OmniItem>> = vaultPropertyKeys(app).map(({ key, count }) => ({
		value: valueRow(
			key,
			key,
			{ kind: "icon", icon: "list" },
			`${count} ${count === 1 ? "note" : "notes"}`,
		),
		terms: [fold(key)],
	}));
	const rows = ordered(entries, query, PICKER_LIMIT);
	// A property nobody has used yet is a perfectly good answer, same as a tag.
	const typed = query.trim();
	if (typed.length > 0 && !rows.some((row) => valueOf(row) === typed)) {
		rows.unshift(valueRow(typed, typed, { kind: "icon", icon: "plus" }, "New property"));
	}
	return rows;
}

// -------------------------------------------------------------- templates

/**
 * Which notes count as templates.
 *
 * The Templates core plugin keeps its folder in its own settings, which is an
 * internal we have no accessor for — so this looks for the conventional folder
 * names instead and falls back to every markdown file rather than showing an
 * empty list. Wrong guess costs the user a longer list, never a missing one.
 */
const TEMPLATE_FOLDERS = ["templates", "template", "vorlagen", "_templates"];

function templateRows(app: App, query: string): OmniItem[] {
	const all = app.vault.getMarkdownFiles();
	const inFolder = all.filter((file) => {
		const folder = file.parent?.path.toLowerCase() ?? "";
		return TEMPLATE_FOLDERS.some((name) => folder === name || folder.endsWith(`/${name}`));
	});
	const corpus = inFolder.length > 0 ? inFolder : all;
	const entries: Array<Scorable<OmniItem>> = corpus.map((file) => ({
		value: valueRow(file.path, file.basename, { kind: "icon", icon: "file-text" }, file.path),
		terms: [fold(file.basename), fold(file.path)],
	}));
	return ordered(entries, query, PICKER_LIMIT);
}

// ----------------------------------------------------------------- colour

/**
 * Obsidian's own eight extended colours, drawn as swatches. The tile takes a
 * CSS value, so `var(--color-red)` is handed straight through and the swatch
 * follows the user's theme — exactly what the emitted markup will do.
 */
function colorRows(query: string): OmniItem[] {
	const entries: Array<Scorable<OmniItem>> = COLOR_NAMES.map((name) => ({
		value: valueRow(name, COLOR_LABELS[name], { kind: "swatch", color: `var(--color-${name})` }),
		terms: [fold(name), fold(COLOR_LABELS[name])],
	}));
	return ordered(entries, query, PICKER_LIMIT);
}

// -------------------------------------------------------------- alignment

const ALIGN_ICONS: Record<Alignment, string> = {
	left: "align-left",
	center: "align-center",
	right: "align-right",
	justify: "align-justify",
};

function alignRows(query: string): OmniItem[] {
	const entries: Array<Scorable<OmniItem>> = (
		Object.keys(ALIGNMENT_LABELS) as Alignment[]
	).map((alignment) => ({
		value: valueRow(alignment, ALIGNMENT_LABELS[alignment], {
			kind: "icon",
			icon: ALIGN_ICONS[alignment],
		}),
		terms: [fold(alignment), fold(ALIGNMENT_LABELS[alignment])],
	}));
	return ordered(entries, query, PICKER_LIMIT);
}

// --------------------------------------------------------------- language

/** Fence languages worth offering; anything else the user simply types. */
const LANGUAGES: readonly string[] = [
	"bash",
	"c",
	"cpp",
	"csharp",
	"css",
	"diff",
	"go",
	"html",
	"java",
	"javascript",
	"json",
	"kotlin",
	"latex",
	"lua",
	"markdown",
	"php",
	"python",
	"ruby",
	"rust",
	"sql",
	"swift",
	"toml",
	"typescript",
	"xml",
	"yaml",
];

function languageRows(query: string): OmniItem[] {
	const entries: Array<Scorable<OmniItem>> = LANGUAGES.map((language) => ({
		value: valueRow(language, language, { kind: "mono", sample: language.slice(0, 2) }),
		terms: [fold(language)],
	}));
	const rows = ordered(entries, query, PICKER_LIMIT);
	const typed = query.trim();
	if (typed.length > 0 && !rows.some((row) => valueOf(row) === typed)) {
		rows.unshift(valueRow(typed, typed, { kind: "mono", sample: typed.slice(0, 2) }));
	}
	return rows;
}

// ------------------------------------------------------------------- text

/**
 * Free input — rename, a callout type, the title of an extracted note.
 *
 * A suggest modal with no rows has no Enter, so the typed text is echoed back
 * as a single row: the field stays a field, and the confirm affordance is
 * where the eye already is. An empty input offers nothing, which is the honest
 * answer to "rename this to ''".
 */
function textRows(prompt: string, query: string): OmniItem[] {
	const typed = query.trim();
	if (typed.length === 0) return [];
	return [valueRow(typed, typed, { kind: "icon", icon: "corner-down-left" }, prompt)];
}

// ------------------------------------------------------------- commands

/**
 * Every registered command, for "Run any command on this…". The registry
 * declares that argument as free text because `ArgumentPicker` has no command
 * kind; offering the real list instead of a text field is strictly better and
 * costs the flow nothing — a page is a page.
 */
function commandRows(app: App, query: string): OmniItem[] {
	const entries: Array<Scorable<OmniItem>> = listCommands(app).map((command) => ({
		value: valueRow(command.id, command.name, {
			kind: "icon",
			icon: command.icon ?? "terminal",
		}),
		terms: [fold(command.name), fold(command.id)],
	}));
	return ordered(entries, query, PICKER_LIMIT);
}

// ------------------------------------------------------------------ build

/** Which page an argument asks for. Exhaustive over `ArgumentPicker`. */
export function pageFor(picker: ArgumentPicker, app: App): BarPage {
	switch (picker.kind) {
		case "folder":
			return folderPage(picker.prompt, app);
		case "tag":
			return {
				kind: "tag",
				label: picker.prompt,
				placeholder: "Search or type a tag…",
				emptyText: "Type a tag.",
				rows: (query) => tagRows(app, query),
				choose: commitRow,
			};
		case "property":
			return {
				kind: "property",
				label: picker.prompt,
				placeholder: "Search or type a property…",
				emptyText: "Type a property name.",
				rows: (query) => propertyRows(app, query),
				choose: commitRow,
			};
		case "template":
			return {
				kind: "template",
				label: picker.prompt,
				placeholder: "Search templates…",
				emptyText: "No template matches.",
				rows: (query) => templateRows(app, query),
				choose: commitRow,
			};
		case "color":
			return {
				kind: "color",
				label: picker.prompt,
				placeholder: "Pick a colour…",
				emptyText: "No colour matches.",
				rows: (query) => colorRows(query),
				choose: commitRow,
			};
		case "align":
			return {
				kind: "align",
				label: picker.prompt,
				placeholder: "Pick an alignment…",
				emptyText: "No alignment matches.",
				rows: (query) => alignRows(query),
				choose: commitRow,
			};
		case "language":
			return {
				kind: "language",
				label: picker.prompt,
				placeholder: "Search or type a language…",
				emptyText: "Type a language.",
				rows: (query) => languageRows(query),
				choose: commitRow,
			};
		case "text":
			return {
				kind: "text",
				label: picker.prompt,
				placeholder: picker.placeholder,
				emptyText: picker.prompt,
				rows: (query) => textRows(picker.prompt, query),
				choose: commitRow,
			};
	}
}

/** The command list, used in place of the declared text field for one action. */
export function commandPage(prompt: string, app: App): BarPage {
	return {
		kind: "command",
		label: prompt,
		placeholder: "Search commands…",
		emptyText: "No command matches.",
		rows: (query) => commandRows(app, query),
		choose: commitRow,
	};
}
