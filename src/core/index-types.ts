/**
 * Types of the full-text index.
 *
 * Pure on purpose: engine.ts is built on these and imports nothing but
 * minisearch, which is what lets the whole index layer be unit-tested under
 * plain vitest with no Obsidian shim. The Obsidian-facing half lives in
 * src/index/ and translates TFile → IndexedDoc at the boundary.
 */

import type { ResultKind } from "./types";

/** Extensions Obsidian renders as images. */
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif"]);

/**
 * Map a file extension to its result kind. Link docs are never produced here
 * — they are emitted per-URL while extracting note content.
 */
export function kindForExtension(extension: string): Exclude<ResultKind, "link"> {
	const ext = extension.toLowerCase();
	if (ext === "md") return "note";
	if (IMAGE_EXTENSIONS.has(ext)) return "image";
	return "file";
}

/** Per-field relevance boosts handed to MiniSearch. */
export interface FieldWeights {
	basename: number;
	aliases: number;
	headings: number;
	tags: number;
	url: number;
	body: number;
	extractedText: number;
}

/**
 * Title fields dominate on purpose: a note actually named "Mira Holt" must be
 * able to beat a note that merely mentions the name fifty times. The
 * deterministic tier ranking in core/rank.ts sits on top of these.
 */
export const DEFAULT_WEIGHTS: FieldWeights = {
	basename: 5,
	aliases: 4,
	headings: 2.5,
	tags: 2,
	url: 1.5,
	body: 1,
	extractedText: 0.8,
};

/**
 * One document in the index. Notes/files/images use their vault path as id;
 * link docs (external URLs found inside a note) use `${notePath}::L${offset}`
 * so a note and its links can be replaced independently.
 */
export interface IndexedDoc {
	id: string;
	kind: ResultKind;
	/** Filename without extension; for link docs: the link's display text. */
	basename: string;
	/** Frontmatter aliases, space-joined (notes only). */
	aliases: string;
	/** Heading texts, space-joined (notes only). */
	headings: string;
	/** Tags without '#', space-joined (notes only). */
	tags: string;
	/** Note body. Indexed but NOT stored — snippets are read lazily. */
	body: string;
	/**
	 * Text pulled out of a binary attachment: OCR for images, the text layer
	 * for PDFs. Filled by `src/ocr/pipeline.ts` when the user opts in, empty
	 * otherwise. Weighted below body text — recognized text is noisier.
	 */
	extractedText: string;
	/** External URL (link docs only). */
	url: string;
	// --- stored-only fields (returned with every hit) ---
	path: string;
	mtime: number;
	/** Alias list kept verbatim for the exact/prefix tier checks in rank.ts. */
	aliasList: string[];
	/** Tag list kept verbatim (no '#') for post-search #tag filtering. */
	tagList: string[];
	/** 0-based line of the link inside its note (link docs only). */
	line?: number;
}

/** A search hit: MiniSearch's score plus the stored fields of the doc. */
export interface SearchHit {
	id: string;
	score: number;
	kind: ResultKind;
	path: string;
	basename: string;
	mtime: number;
	aliasList: string[];
	tagList: string[];
	url?: string;
	line?: number;
}
