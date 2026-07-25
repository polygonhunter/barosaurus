import type { BlockDef, InsertPlan, TemplateEnv, UserSnippet } from "./blocks";
import { blockIdFromActionId, CALLOUT_TYPES, findInsertBlock } from "./catalog";
import { formatWithPattern } from "./dateformat";
import { buildInsertion } from "./insert";
import {
	applyAlignment,
	applyBackground,
	applyForeground,
	containsMarkdownSyntax,
	COLOR_NAMES,
	type Alignment,
	type ColorMode,
	type ColorName,
} from "./style";

/**
 * The missing link between an action id and the text that replaces the
 * selection.
 *
 * `core/actions.ts` knows the ids and when they apply. `core/style.ts`,
 * `core/wrap.ts` and `core/insert.ts` know how to produce the markup. Nothing
 * joined them, so the whole "Editing" half of the bar — colours, alignment,
 * list conversion, callouts, snippets, the date format — was settings with no
 * code behind them. This is that code, and it stays pure: an id, a selection
 * and the user's settings in, replacement text and a cursor out. Every
 * obsidian-shaped thing (reading the editor, writing the replacement, showing
 * the Notice) belongs to the executor.
 */

export interface EditingSettings {
	/** Theme variables or hex, straight off BarosaurusSettings. */
	colorMode: ColorMode;
	/** The user's date pattern, e.g. "YYYY-MM-DD". */
	dateFormat: string;
	/** User-defined blocks; only needed for the snippet ids. */
	snippets: readonly UserSnippet[];
}

export interface EditingRequest {
	/** An id from core/actions.ts, or `insert-block:<blockId>`. */
	actionId: string;
	/** The selected text. Empty string when there is no selection. */
	selection: string;
	/**
	 * Whatever the argument page collected: a colour name, an alignment, a
	 * callout type, a code language, a snippet name. Null when the action takes
	 * none, or when the picker was skipped.
	 */
	argument?: string | null;
	settings: EditingSettings;
	/** Injected so tests are deterministic; defaults to now. */
	now?: Date;
	/** Callouts only: start the callout folded. */
	folded?: boolean;
	/**
	 * Whole document text. Only footnotes need it — they place a marker at the
	 * cursor and a definition at the very end — and the plan simply refuses
	 * rather than guessing when it is missing.
	 */
	document?: string;
}

export interface EditingResult extends InsertPlan {
	/**
	 * The selection carried markdown AND was wrapped in an HTML element.
	 *
	 * Obsidian's own docs say "Obsidian does not render Markdown syntax inside
	 * HTML elements", then immediately qualify it for `<span>` — which is
	 * exactly what the colour actions emit. docs/findings.md §1 is the open
	 * gate. Until it is closed, the honest thing is to hand the caller the fact
	 * and let it warn ONCE, rather than silently producing a note full of
	 * visible asterisks. False when the action removed a wrapper instead of
	 * adding one, because unwrapping can never make rendering worse.
	 */
	markdownInsideHtml: boolean;
	/**
	 * Text to append at the very end of the document, after the replacement has
	 * been written. Only footnotes use it.
	 */
	appendToDocument?: string;
}

/** Ids handled here that are not an `insert-block:` id. */
export const EDITING_ACTION_IDS: readonly string[] = [
	"text-color",
	"background-color",
	"align",
	"to-task",
	"to-bullets",
	"to-quote",
	"link-from-selection",
	"wrap-callout",
	"insert-date",
	"insert-snippet",
];

const EDITING_ACTION_SET = new Set(EDITING_ACTION_IDS);

/** Does this module own the id? The executor routes on exactly this. */
export function handlesEditing(actionId: string): boolean {
	return EDITING_ACTION_SET.has(actionId) || blockIdFromActionId(actionId) !== null;
}

// ------------------------------------------------------------------ parsing

/** German synonyms for the eight palette colours, folded before comparison. */
const COLOR_SYNONYMS: Readonly<Record<string, ColorName>> = {
	rot: "red",
	orange: "orange",
	gelb: "yellow",
	grün: "green",
	gruen: "green",
	tuerkis: "cyan",
	türkis: "cyan",
	blau: "blue",
	lila: "purple",
	violett: "purple",
	rosa: "pink",
};

export function parseColorName(value: string | null | undefined): ColorName | null {
	if (value === null || value === undefined) return null;
	const key = value.trim().toLowerCase();
	const direct = COLOR_NAMES.find((name) => name === key);
	if (direct !== undefined) return direct;
	return COLOR_SYNONYMS[key] ?? null;
}

const ALIGNMENT_SYNONYMS: Readonly<Record<string, Alignment>> = {
	left: "left",
	links: "left",
	linksbündig: "left",
	center: "center",
	centre: "center",
	mitte: "center",
	zentriert: "center",
	right: "right",
	rechts: "right",
	rechtsbündig: "right",
	justify: "justify",
	blocksatz: "justify",
};

export function parseAlignment(value: string | null | undefined): Alignment | null {
	if (value === null || value === undefined) return null;
	return ALIGNMENT_SYNONYMS[value.trim().toLowerCase()] ?? null;
}

/**
 * Sanitise a callout type. Obsidian allows custom types, so an unrecognised
 * one is passed through rather than replaced — but only after anything that
 * would break the `> [!type]` syntax is stripped, and a German alias is mapped
 * onto the canonical type so "warnung" produces a real warning callout.
 */
export function normalizeCalloutType(value: string | null | undefined): string {
	const raw = (value ?? "").trim().toLowerCase();
	if (raw.length === 0) return "note";
	const known = CALLOUT_TYPES.find(
		(spec) => spec.type === raw || spec.aliases.includes(raw),
	);
	if (known !== undefined) return known.type;
	const safe = raw.replace(/[^a-z0-9-]/g, "");
	return safe.length > 0 ? safe : "note";
}

/** Fenced-code languages are written verbatim into the fence — keep them tame. */
export function normalizeLanguage(value: string | null | undefined): string | null {
	const safe = (value ?? "").trim().toLowerCase().replace(/[^a-z0-9+#-]/g, "");
	return safe.length > 0 ? safe : null;
}

// -------------------------------------------------------------- line prefix

/**
 * Every list-ish marker a line may already carry: a blockquote arrow, a task
 * checkbox, a bullet, an ordered number. Repeated, so "> - done" is stripped
 * back to "done" in one pass.
 *
 * `[-*+]\s+` requires whitespace after the marker on purpose: without it,
 * "-5 degrees" would lose its minus sign.
 */
const MARKER_RE = /^(?:>\s?|[-*+]\s+\[[^\]]?\]\s+|[-*+]\s+|\d+[.)]\s+)+/;

/** Leading indentation, preserved across a conversion so nesting survives. */
const INDENT_RE = /^[ \t]*/;

export interface LinePrefixSpec {
	/** The marker to put on every line, e.g. "- [ ] ". */
	prefix: string;
	/** Recognises the marker already being there, for the toggle-off case. */
	present: RegExp;
	/**
	 * Blockquotes need their blank lines kept and prefixed or the quote breaks
	 * into two; a list must not grow an empty bullet between two paragraphs.
	 */
	keepBlankLines: boolean;
}

const TASK_SPEC: LinePrefixSpec = {
	prefix: "- [ ] ",
	present: /^[ \t]*[-*+]\s+\[[^\]]?\]\s/,
	keepBlankLines: false,
};

const BULLET_SPEC: LinePrefixSpec = {
	prefix: "- ",
	present: /^[ \t]*[-*+]\s+(?!\[[^\]]?\]\s)/,
	keepBlankLines: false,
};

const QUOTE_SPEC: LinePrefixSpec = {
	prefix: "> ",
	present: /^[ \t]*>\s?/,
	keepBlankLines: true,
};

/** "1. " → "3. " for the third line; anything else passes through unchanged. */
function markerForLine(prefix: string, index: number): string {
	const numbered = /^(\d+)([.)] )$/.exec(prefix);
	if (numbered === null || numbered[1] === undefined || numbered[2] === undefined) return prefix;
	return `${Number(numbered[1]) + index}${numbered[2]}`;
}

/**
 * Turn a selection into a list, a task list or a quote.
 *
 * Three things `core/wrap.ts` deliberately does not do, because it never
 * inspects the selection it is handed:
 *  - strip the marker a line already carries, so "turn into bullets" on a
 *    numbered list converts instead of stacking "- 1. item";
 *  - keep indentation in front of the new marker rather than behind it;
 *  - toggle: a selection that is already entirely the target markup loses it,
 *    the same semantics core/style.ts gives the colours.
 *
 * Renumbering follows wrap.ts's rule exactly, so a numbered prefix counts up
 * here the same way it does there.
 */
export function prefixSelection(selection: string, spec: LinePrefixSpec): string {
	const lines = selection.split("\n");
	const meaningful = lines.filter((line) => line.trim().length > 0);

	const stripped = lines.map((line) => {
		const indent = INDENT_RE.exec(line)?.[0] ?? "";
		return indent + line.slice(indent.length).replace(MARKER_RE, "");
	});

	// Already entirely the target markup → remove it instead of doubling it.
	if (meaningful.length > 0 && meaningful.every((line) => spec.present.test(line))) {
		return stripped.join("\n");
	}

	const kept = spec.keepBlankLines
		? stripped
		: stripped.filter((line) => line.trim().length > 0);
	const body = kept.length > 0 ? kept : [""];
	return body
		.map((line, index) => {
			const indent = INDENT_RE.exec(line)?.[0] ?? "";
			const rest = line.slice(indent.length);
			const marker = markerForLine(spec.prefix, index);
			// A blank line INSIDE a quote still needs the arrow to keep the
			// blockquote in one piece — but not the space after it, which would
			// leave trailing whitespace on every empty line of the note. An
			// empty selection is the other case entirely: there the prefix is a
			// fresh marker for the user to type behind, space and all.
			const blankInsideBlock = rest.length === 0 && body.length > 1;
			return indent + (blankInsideBlock ? marker.trimEnd() : marker + rest);
		})
		.join("\n");
}

// ------------------------------------------------------------------- plans

/**
 * The cursor for text that carries no `{cursor}` sentinel: the very end.
 *
 * Not `resolveCursor()` — that searches for the literal string "{cursor}", and
 * a selection the user typed may contain it. For a template it is a sentinel;
 * for arbitrary selected text it is just eleven characters that must survive.
 */
function atEndOf(text: string): InsertPlan {
	const lines = text.split("\n");
	return {
		text,
		cursor: { lineDelta: lines.length - 1, ch: lines[lines.length - 1]?.length ?? 0 },
	};
}

function plain(plan: InsertPlan): EditingResult {
	return { ...plan, markdownInsideHtml: false };
}

/**
 * A result for one of the HTML wrappers. The warning fires only when the text
 * actually grew, which is what separates "wrapped it" from "unwrapped it".
 */
function wrapped(selection: string, text: string): EditingResult {
	return {
		...atEndOf(text),
		markdownInsideHtml: text.length > selection.length && containsMarkdownSyntax(selection),
	};
}

function templateEnv(request: EditingRequest, language: string | null): TemplateEnv {
	return {
		selection: request.selection.length > 0 ? request.selection : null,
		date: formatWithPattern(request.now ?? new Date(), request.settings.dateFormat),
		folded: request.folded ?? false,
		language,
	};
}

/** A blockquote arrow on a line that is about to go inside a callout. */
function stripQuoteMarkers(selection: string): string {
	return selection
		.split("\n")
		.map((line) => {
			const indent = INDENT_RE.exec(line)?.[0] ?? "";
			return indent + line.slice(indent.length).replace(/^(?:>\s?)+/, "");
		})
		.join("\n");
}

/**
 * Footnotes are two edits: a marker where the cursor is and a definition at the
 * very end of the document. The next number is the highest numeric footnote
 * plus one; named footnotes (`[^why]`) do not participate in the numbering.
 */
export function planFootnote(doc: string, selection = ""): EditingResult {
	let highest = 0;
	const pattern = /\[\^(\d+)\]/g;
	let match: RegExpExecArray | null = pattern.exec(doc);
	while (match !== null) {
		highest = Math.max(highest, Number(match[1]));
		match = pattern.exec(doc);
	}
	const marker = `[^${highest + 1}]`;
	const needsNewline = doc.length > 0 && !doc.endsWith("\n");
	return {
		// The marker goes BEHIND the selection rather than over it: the
		// replacement overwrites whatever was selected, and a footnote that
		// eats the sentence it annotates is the worst kind of data loss.
		...atEndOf(selection + marker),
		markdownInsideHtml: false,
		appendToDocument: `${needsNewline ? "\n" : ""}${marker}: `,
	};
}

/**
 * Plan one edit. Returns null when the id is not ours, when a required
 * argument is missing or unparseable, or when the entry needs the document and
 * did not get it — never a half-applied edit.
 */
export function planEdit(request: EditingRequest): EditingResult | null {
	const { actionId, selection, argument, settings } = request;

	switch (actionId) {
		case "text-color": {
			const color = parseColorName(argument);
			if (color === null) return null;
			return wrapped(selection, applyForeground(selection, color, settings.colorMode));
		}
		case "background-color": {
			const color = parseColorName(argument);
			if (color === null) return null;
			return wrapped(selection, applyBackground(selection, color, settings.colorMode));
		}
		case "align": {
			const alignment = parseAlignment(argument);
			if (alignment === null) return null;
			return wrapped(selection, applyAlignment(selection, alignment));
		}
		case "to-task":
			return plain(atEndOf(prefixSelection(selection, TASK_SPEC)));
		case "to-bullets":
			return plain(atEndOf(prefixSelection(selection, BULLET_SPEC)));
		case "to-quote":
			return plain(atEndOf(prefixSelection(selection, QUOTE_SPEC)));
		case "link-from-selection": {
			// Turn the selected words into a wikilink to a note of that name.
			// Obsidian resolves an unresolved one lazily, so this is the
			// "write first, create later" flow people actually use — and the
			// ghost source will offer to create it afterwards.
			const title = selection.trim();
			if (title.length === 0) return null;
			// Already a wikilink? Unwrap, so the verb toggles like the others.
			const wrapped = /^\[\[([^\]]+)\]\]$/.exec(title);
			return plain(atEndOf(wrapped?.[1] !== undefined ? wrapped[1] : `[[${title}]]`));
		}
		case "wrap-callout": {
			const type = normalizeCalloutType(argument);
			const def: BlockDef = {
				id: `callout-${type}`,
				name: type,
				aliases: [],
				group: "actions",
				template: `> [!${type}]{fold}\n> {cursor}`,
				wrap: "prefixLines",
				linePrefix: "> ",
				tile: { kind: "callout", calloutType: type },
			};
			// A selection that is already quoted would otherwise nest a second
			// blockquote inside the callout.
			const cleaned = { ...request, selection: stripQuoteMarkers(selection) };
			return plain(buildInsertion(def, templateEnv(cleaned, null)));
		}
		case "insert-date": {
			const def = findInsertBlock("date");
			if (def === null) return null;
			return plain(buildInsertion(def, templateEnv(request, null)));
		}
		case "insert-snippet": {
			const wanted = (argument ?? "").trim().toLowerCase();
			const def = settings.snippets
				.filter((entry) => entry.name.trim().length > 0 && entry.template.length > 0)
				.find((entry) => entry.name.trim().toLowerCase() === wanted);
			if (def === undefined) return null;
			return plain(
				buildInsertion(
					{
						id: "snippet",
						name: def.name,
						aliases: [],
						group: "actions",
						template: def.template,
						wrap: "inline",
						tile: { kind: "icon", icon: "scissors" },
					},
					templateEnv(request, null),
				),
			);
		}
	}

	const blockId = blockIdFromActionId(actionId);
	if (blockId === null) return null;
	const def = findInsertBlock(blockId, settings.snippets);
	if (def === null) return null;

	if (def.special === "footnote") {
		return request.document === undefined ? null : planFootnote(request.document, selection);
	}
	// A block that only borrows a registered command has no text of its own.
	if (def.special === "command") return null;

	const language = def.special === "codeblock" ? normalizeLanguage(argument) : null;
	const source =
		def.wrap === "prefixLines" && def.linePrefix === "> "
			? { ...request, selection: stripQuoteMarkers(selection) }
			: request;
	return plain(buildInsertion(def, templateEnv(source, language)));
}
