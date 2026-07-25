import { fold } from "./normalize";
import type { ResultKind } from "./types";

/**
 * The bar takes ONE input for everything, so the grammar has to say "I mean
 * commands" without a mode switch. Sigils do that, and we borrow the ones
 * from the most widely known command palette there is (VS Code) rather than
 * inventing our own:
 *
 *   >query   commands only
 *   @query   headings and blocks of the ACTIVE note
 *   :42      jump to a line in the active note
 *
 * `#` deliberately stays what it is in Searchosaurus — a tag filter — because
 * overloading it for headings would silently break `#project/design`.
 *
 * Everything after the sigil keeps the full operator grammar, so
 * `>toggle -sidebar` and `@intro` both work.
 */

export type QueryScope = "all" | "command" | "symbol" | "line";

export interface ParsedQuery {
	/** Which sources may answer at all. */
	scope: QueryScope;
	/** Leading n/f/i/l (d = f alias) operator, if any. */
	kind: ResultKind | null;
	text: string;
	/** #tag tokens (folded, '#' stripped). */
	tags: string[];
	/** p:/path:/pfad: prefix filter (verbatim, case-insensitive compare). */
	pathPrefix: string | null;
	/** "quoted" exact phrases (verbatim; fold at match time). */
	phrases: string[];
	/** -excluded words. */
	excludes: string[];
	/** mod:… recency filter in days, null = no filter. */
	modifiedWithinDays: number | null;
	/** Target line for the ":42" scope. */
	line: number | null;
}

const KIND_BY_LETTER: Record<string, ResultKind> = {
	n: "note",
	f: "file",
	d: "file", // "document" — merged into file, but the muscle memory works
	i: "image",
	l: "link",
};

const MOD_ALIASES: Record<string, number> = {
	today: 1,
	heute: 1,
	week: 7,
	woche: 7,
	month: 31,
	monat: 31,
	year: 366,
	jahr: 366,
};

const PHRASE_RE = /"([^"]*)"/g;

export function parseQuery(raw: string): ParsedQuery {
	const result: ParsedQuery = {
		scope: "all",
		kind: null,
		text: "",
		tags: [],
		pathPrefix: null,
		phrases: [],
		excludes: [],
		modifiedWithinDays: null,
		line: null,
	};

	let rest = raw;

	// Sigils bind WITHOUT a following space and must work on their own — ">"
	// alone means "show me every command". That is the opposite of the kind
	// operator below, which requires whitespace and a non-empty remainder, so
	// it has to be its own step in front.
	const lineMatch = /^:\s*(\d+)\s*$/.exec(rest);
	if (lineMatch && lineMatch[1] !== undefined) {
		result.scope = "line";
		result.line = Number(lineMatch[1]);
		return result;
	}

	const sigil = rest[0];
	if (sigil === ">") {
		result.scope = "command";
		rest = rest.slice(1);
	} else if (sigil === "@") {
		result.scope = "symbol";
		rest = rest.slice(1);
	}

	const kindMatch = /^([nfdil])\s+(\S[\s\S]*)$/i.exec(rest);
	if (kindMatch && kindMatch[1] && kindMatch[2] !== undefined) {
		result.kind = KIND_BY_LETTER[kindMatch[1].toLowerCase()] ?? null;
		rest = kindMatch[2];
	}

	rest = rest.replace(PHRASE_RE, (_all, phrase: string) => {
		const trimmed = phrase.trim();
		if (trimmed.length > 0) result.phrases.push(trimmed);
		return " ";
	});

	const words: string[] = [];
	for (const token of rest.split(/\s+/)) {
		if (token.length === 0) continue;
		if (token.startsWith("#") && token.length > 1) {
			result.tags.push(fold(token.slice(1)));
			continue;
		}
		if (token.startsWith("-") && token.length > 1) {
			result.excludes.push(token.slice(1));
			continue;
		}
		const colon = /^(p|path|pfad):(.+)$/i.exec(token);
		if (colon && colon[2]) {
			result.pathPrefix = colon[2];
			continue;
		}
		const mod = /^mod:(\S+)$/i.exec(token);
		if (mod && mod[1]) {
			const days = MOD_ALIASES[mod[1].toLowerCase()];
			if (days !== undefined) {
				result.modifiedWithinDays = days;
				continue;
			}
		}
		words.push(token);
	}

	// Phrase words also feed the engine query — the phrase itself is
	// verified verbatim afterwards (containsPhrase) on the candidates.
	result.text = [...words, ...result.phrases].join(" ").trim();
	return result;
}

/**
 * Is this the empty state (show the launcher) rather than a search?
 *
 * The subtle part: a bare ">" has no text and no tags, so a naive emptiness
 * check would show pins and recents instead of the command list it promises.
 * A narrowed scope is never empty.
 */
export function isEmptyQuery(parsed: ParsedQuery): boolean {
	return parsed.scope === "all" && parsed.text.length === 0 && parsed.tags.length === 0;
}

/** Does `text` contain `phrase` verbatim after folding? */
export function containsPhrase(text: string, phrase: string): boolean {
	const foldedPhrase = fold(phrase);
	if (foldedPhrase.length === 0) return true;
	return fold(text).includes(foldedPhrase);
}

/** Does any of the (folded) stored tags match the folded query tag? */
export function matchesTag(tagList: readonly string[], foldedQueryTag: string): boolean {
	return tagList.some((tag) => {
		const foldedTag = fold(tag);
		// fold() turns "project/design" into "project design", so the trailing
		// space is what makes nested tags match by prefix without "projection"
		// also matching "project".
		return foldedTag === foldedQueryTag || foldedTag.startsWith(`${foldedQueryTag} `);
	});
}
