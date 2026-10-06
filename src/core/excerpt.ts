import { fold } from "./normalize";

/**
 * Finding "where in this note did it match", without Obsidian.
 *
 * Shared by the preview (which windows the note around the spot), the
 * full-text source (which shows a one-line snippet as the row's subtitle) and
 * the executor (which opens the note scrolled to that line). Pure, so all
 * three agree and the tests need no vault.
 */

/** The preview's excerpt cap — enough context, never the whole 300 KB note. */
export const MAX_EXCERPT_CHARS = 1800;
/** A row subtitle: one glance, not a paragraph. */
export const SNIPPET_CHARS = 80;
/** Lines inspected before giving up — the index caps bodies far above this. */
const MAX_LINES_SCANNED = 20_000;

/**
 * 0-based line of the first line containing any of `words`, compared folded
 * (so "Uberblick" finds "Überblick" exactly as the index did), or null.
 * `words` must already be folded — `foldedWords(query)`.
 */
export function findMatchLine(body: string, words: readonly string[]): number | null {
	const wanted = words.filter((word) => word.length > 1);
	if (wanted.length === 0) return null;
	const lines = body.split("\n");
	const limit = Math.min(lines.length, MAX_LINES_SCANNED);
	for (let i = 0; i < limit; i++) {
		const line = lines[i] ?? "";
		// Cheap reject before folding: a line that is pure markup or empty.
		if (line.trim().length === 0) continue;
		const folded = fold(line);
		if (wanted.some((word) => folded.includes(word))) return i;
	}
	return null;
}

/**
 * The matching line as a short, readable snippet: list/heading/quote markers
 * dropped, whitespace collapsed, cut to `max` characters around the first
 * word that can be located in the raw text.
 */
export function snippetAt(
	body: string,
	line: number,
	words: readonly string[],
	max = SNIPPET_CHARS,
): string {
	const raw = body.split("\n")[line] ?? "";
	const text = raw
		.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[.\]\s+)?|\d+[.)]\s+|>\s*)+/, "")
		.replace(/\s+/g, " ")
		.trim();
	if (text.length <= max) return text;
	const lower = text.toLowerCase();
	let at = -1;
	for (const word of words) {
		const index = lower.indexOf(word);
		if (index !== -1 && (at === -1 || index < at)) at = index;
	}
	// Umlauts and the like: the folded word is not in the raw text. Fall back
	// to the line's start rather than guessing an offset.
	const start = at <= max / 3 ? 0 : at - Math.floor(max / 3);
	const cut = text.slice(start, start + max).trim();
	return `${start > 0 ? "…" : ""}${cut}${start + max < text.length ? "…" : ""}`;
}

/**
 * Window the raw markdown around the interesting spot, cut on line borders so
 * a fence or a list never starts halfway through.
 *
 * The line wins over the query words when there is one: a heading result knows
 * exactly where it lives, and guessing from the query would land the excerpt
 * on some other occurrence of the same word.
 */
export function excerptAround(
	body: string,
	queryWords: readonly string[],
	line?: number,
	maxChars = MAX_EXCERPT_CHARS,
): string {
	if (body.length <= maxChars) return body;

	let focus = -1;
	if (line !== undefined && line > 0) {
		const lines = body.split("\n");
		if (line < lines.length) {
			focus = lines.slice(0, line).reduce((sum, text) => sum + text.length + 1, 0);
		}
	}
	if (focus === -1) {
		const lower = body.toLowerCase();
		for (const word of queryWords) {
			const index = lower.indexOf(word.toLowerCase());
			if (index !== -1 && (focus === -1 || index < focus)) focus = index;
		}
	}
	if (focus === -1) return body.slice(0, maxChars);

	const start = body.lastIndexOf("\n", Math.max(0, focus - maxChars / 3));
	const end = body.indexOf("\n", focus + maxChars / 2);
	return body.slice(start === -1 ? 0 : start + 1, end === -1 ? body.length : end);
}
