/**
 * Text normalization shared by EVERY comparison layer: MiniSearch's
 * processTerm (index + query time) and the title-tier checks in rank.ts.
 * If these ever diverge, umlaut titles silently stop hitting tier 0.
 */

/** Strips combining marks left over after NFD decomposition (é → e). */
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

/** Anything that is neither letter, digit nor whitespace. */
const PUNCTUATION_RE = /[^\p{L}\p{N}\s]/gu;

/**
 * Fold a term or title for matching: lowercase, ß→ss, diacritics removed,
 * punctuation stripped, whitespace collapsed. Returns "" for empty input —
 * callers feeding MiniSearch's processTerm map "" to null themselves.
 */
export function fold(text: string): string {
	return text
		.toLowerCase()
		.replace(/ß/g, "ss")
		.normalize("NFD")
		.replace(COMBINING_MARKS_RE, "")
		.replace(PUNCTUATION_RE, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** processTerm for MiniSearch: folded term, or null to drop the term. */
export function processTerm(term: string): string | null {
	const folded = fold(term);
	return folded.length > 0 ? folded : null;
}

/** Folded whitespace-split words of a query or title. */
export function foldedWords(text: string): string[] {
	const folded = fold(text);
	return folded.length > 0 ? folded.split(" ") : [];
}

/**
 * Initials of the folded words, for acronym matching: "Toggle bold text" → "tbt".
 * Digits stay as their own character so "h2" still matches "Heading 2".
 */
export function acronym(text: string): string {
	return foldedWords(text)
		.map((word) => word[0] ?? "")
		.join("");
}

/** `fold` for ONE character, without the whitespace collapse. May be "" or "ss". */
function foldChar(char: string): string {
	return char
		.toLowerCase()
		.replace(/ß/g, "ss")
		.normalize("NFD")
		.replace(COMBINING_MARKS_RE, "")
		.replace(PUNCTUATION_RE, " ");
}

/**
 * Where the first of `words` occurs in RAW text, as [start, end) offsets into
 * that raw string, compared folded — or null when none does.
 *
 * The bridge between fold()-based matching and anything that has to cut the
 * real text, like a highlighter: folding changes lengths (ß → ss, é → e + a
 * dropped mark), so an offset found in `fold(text)` does not point into
 * `text`. `words` must already be folded and contain no spaces —
 * `foldedWords(query)`.
 */
export function findFolded(text: string, words: readonly string[]): [number, number] | null {
	let folded = "";
	/** Per folded code unit: the raw range of the character it came from. */
	const starts: number[] = [];
	const ends: number[] = [];
	let at = 0;
	for (const char of text) {
		const end = at + char.length;
		const piece = foldChar(char);
		if (piece.length === 0) {
			// A lone combining mark belongs to the letter before it.
			if (ends.length > 0) ends[ends.length - 1] = end;
		} else {
			folded += piece;
			for (let i = 0; i < piece.length; i++) {
				starts.push(at);
				ends.push(end);
			}
		}
		at = end;
	}

	let best = -1;
	let length = 0;
	for (const word of words) {
		if (word.length === 0) continue;
		const index = folded.indexOf(word);
		if (index !== -1 && (best === -1 || index < best)) {
			best = index;
			length = word.length;
		}
	}
	if (best === -1) return null;
	return [starts[best] ?? 0, ends[best + length - 1] ?? text.length];
}
