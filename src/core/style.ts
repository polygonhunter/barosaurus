/**
 * Colour and alignment, written the way Obsidian's own documentation says to
 * write it.
 *
 * The docs (Editing and formatting → HTML content) state that Obsidian renders
 * sanitized HTML and give this exact example:
 *
 *   <span style="font-family: cursive">your text</span>
 *
 * So `<span style="…">` is the sanctioned mechanism. Editing Toolbar's
 * `<font color="…">` is not — it is obsolete since HTML5 and appears nowhere
 * in the docs. We write the documented form and merely RECOGNISE the legacy
 * one, so a vault that has both plugins never ends up double-wrapped.
 *
 * The palette is Obsidian's own eight extended colours, which carry separate
 * light and dark values. Emitting `var(--color-red)` therefore stays readable
 * when the user flips the theme — a hard-coded hex does not. Users who export
 * to Pandoc or GitHub can switch to hex, where var() would not resolve.
 *
 * Documented caveat that shapes the UX: "Obsidian does not render Markdown
 * syntax inside HTML elements." Colouring a selection that itself contains
 * markdown may therefore show the literal syntax. For inline `<span>` the docs
 * call the behaviour ambiguous, so it is a verification gate in
 * docs/findings.md rather than an assumption baked in here.
 */

export type ColorName = "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "purple" | "pink";

export const COLOR_NAMES: readonly ColorName[] = [
	"red",
	"orange",
	"yellow",
	"green",
	"cyan",
	"blue",
	"purple",
	"pink",
];

/** Sentence case labels, DE aliases live in the catalog. */
export const COLOR_LABELS: Record<ColorName, string> = {
	red: "Red",
	orange: "Orange",
	yellow: "Yellow",
	green: "Green",
	cyan: "Cyan",
	blue: "Blue",
	purple: "Purple",
	pink: "Pink",
};

/** Obsidian's documented light-mode defaults, used only in hex mode. */
const HEX_LIGHT: Record<ColorName, string> = {
	red: "#e93147",
	orange: "#ec7500",
	yellow: "#e0ac00",
	green: "#08b94e",
	cyan: "#00bfbc",
	blue: "#086ddd",
	purple: "#7852ee",
	pink: "#d53984",
};

/** Matching RGB triples, for translucent backgrounds in hex mode. */
const RGB_LIGHT: Record<ColorName, string> = {
	red: "233, 49, 71",
	orange: "236, 117, 0",
	yellow: "224, 172, 0",
	green: "8, 185, 78",
	cyan: "0, 191, 188",
	blue: "8, 109, 221",
	purple: "120, 82, 238",
	pink: "213, 57, 132",
};

export type ColorMode = "theme" | "hex";

/** Background tint strength — the value Obsidian's own docs use. */
const BACKGROUND_ALPHA = 0.2;

export function foregroundValue(color: ColorName, mode: ColorMode): string {
	return mode === "hex" ? HEX_LIGHT[color] : `var(--color-${color})`;
}

export function backgroundValue(color: ColorName, mode: ColorMode): string {
	const rgb = mode === "hex" ? RGB_LIGHT[color] : `var(--color-${color}-rgb)`;
	return `rgba(${rgb}, ${BACKGROUND_ALPHA})`;
}

export type Alignment = "left" | "center" | "right" | "justify";

export const ALIGNMENT_LABELS: Record<Alignment, string> = {
	left: "Align left",
	center: "Align center",
	right: "Align right",
	justify: "Justify",
};

// ------------------------------------------------------------ recognition

/** Our own foreground wrapper, either mode. */
const OURS_FOREGROUND_RE =
	/^<span style="color:\s*(?:var\(--color-[a-z]+\)|#[0-9a-fA-F]{3,8});?\s*">([\s\S]*)<\/span>$/;

/**
 * Our own background wrapper, either mode.
 *
 * The alternation is load-bearing, not decoration: theme mode emits
 * `rgba(var(--color-red-rgb), 0.2)`, and a naive `[^)]*` stops at the closing
 * paren of the INNER var(), so it never matches its own output. One nested
 * parenthesis group is all the value can ever contain.
 */
const OURS_BACKGROUND_RE =
	/^<mark style="background:\s*rgba\((?:[^()]|\([^()]*\))*\);?\s*">([\s\S]*)<\/mark>$/;

/** Editing Toolbar's legacy markup — recognised so we can undo it cleanly. */
const LEGACY_FONT_RE = /^<font\s+color=["']?[^"'>]+["']?>([\s\S]*)<\/font>$/;
const LEGACY_MARK_RE = /^<mark\s+style=["']?background:[^"'>]+["']?>([\s\S]*)<\/mark>$/;

/** Alignment wrappers, ours and Editing Toolbar's `<p align>`. */
const OURS_ALIGN_RE = /^<div style="text-align:\s*[a-z]+;?\s*">\n?([\s\S]*?)\n?<\/div>$/;
const LEGACY_ALIGN_RE = /^<p\s+align=["']?[a-z]+["']?>([\s\S]*)<\/p>$/;

function unwrapWith(selection: string, patterns: readonly RegExp[]): string | null {
	const trimmed = selection.trim();
	for (const pattern of patterns) {
		const match = pattern.exec(trimmed);
		if (match && match[1] !== undefined) return match[1];
	}
	return null;
}

/** Strip any recognised foreground wrapper; null when there is none. */
export function unwrapForeground(selection: string): string | null {
	return unwrapWith(selection, [OURS_FOREGROUND_RE, LEGACY_FONT_RE]);
}

/** Strip any recognised background wrapper; null when there is none. */
export function unwrapBackground(selection: string): string | null {
	return unwrapWith(selection, [OURS_BACKGROUND_RE, LEGACY_MARK_RE]);
}

/** Strip any recognised alignment wrapper; null when there is none. */
export function unwrapAlignment(selection: string): string | null {
	return unwrapWith(selection, [OURS_ALIGN_RE, LEGACY_ALIGN_RE]);
}

// ------------------------------------------------------------ application

/**
 * Toggle semantics throughout: applying the colour a selection already has
 * removes it, applying a different one replaces it. Wrapping a wrapped
 * selection again is the single most annoying failure mode of every other
 * formatting plugin.
 */
export function applyForeground(selection: string, color: ColorName, mode: ColorMode): string {
	const inner = unwrapForeground(selection);
	const value = foregroundValue(color, mode);
	if (inner !== null) {
		const already = selection.trim().includes(value);
		return already ? inner : `<span style="color: ${value};">${inner}</span>`;
	}
	return `<span style="color: ${value};">${selection}</span>`;
}

export function applyBackground(selection: string, color: ColorName, mode: ColorMode): string {
	const inner = unwrapBackground(selection);
	const value = backgroundValue(color, mode);
	if (inner !== null) {
		const already = selection.trim().includes(value);
		return already ? inner : `<mark style="background: ${value};">${inner}</mark>`;
	}
	return `<mark style="background: ${value};">${selection}</mark>`;
}

/**
 * Alignment is block level, so it gets a `<div>` on its own lines. The docs
 * warn that an HTML block must not contain a blank line, so a selection
 * spanning paragraphs is aligned as one block rather than per paragraph —
 * splitting it would produce markup Obsidian refuses to render.
 */
export function applyAlignment(selection: string, alignment: Alignment): string {
	const inner = unwrapAlignment(selection) ?? selection;
	if (alignment === "left") return inner; // the default needs no wrapper
	const already = new RegExp(`text-align:\\s*${alignment}\\b`).test(selection.trim());
	if (already && unwrapAlignment(selection) !== null) return inner;
	return `<div style="text-align: ${alignment};">\n${inner}\n</div>`;
}

/**
 * Does this selection contain markdown that will stop rendering once wrapped?
 * The bar uses this to warn once rather than silently producing a note full of
 * visible asterisks.
 */
export function containsMarkdownSyntax(selection: string): boolean {
	return /(\*\*|__|==|~~|`|^\s*[-*+]\s|^\s*#{1,6}\s|\[\[)/m.test(selection);
}
