import { getAllTags, parseFrontMatterAliases, type App, type TFile } from "obsidian";
import { kindForExtension, type IndexedDoc } from "../core/index-types";

/**
 * Turning one vault file into index documents. This is the Obsidian-facing
 * half of the index — everything it produces is a plain IndexedDoc that
 * src/core/engine.ts can swallow without knowing what a TFile is.
 */

/** Cap what a single note contributes to the index (pathological files). */
const MAX_BODY_LENGTH = 300_000;
/** Cap link docs per note (paste-dump protection). */
const MAX_LINKS_PER_NOTE = 200;

function emptyDoc(file: TFile): IndexedDoc {
	return {
		id: file.path,
		kind: kindForExtension(file.extension),
		basename: file.basename,
		aliases: "",
		headings: "",
		tags: "",
		body: "",
		extractedText: "",
		url: "",
		path: file.path,
		mtime: file.stat.mtime,
		aliasList: [],
		tagList: [],
	};
}

/**
 * Attachment doc: searchable by filename, plus whatever text an extractor
 * managed to pull out of it. Barosaurus has no OCR/PDF pipeline, so
 * `extractedText` is empty today — this is the seam where one would land.
 */
export function attachmentDoc(file: TFile, extractedText = ""): IndexedDoc {
	const doc = emptyDoc(file);
	doc.extractedText = extractedText;
	return doc;
}

/**
 * Build the index doc(s) for one vault file. Notes get their metadata-cache
 * fields (aliases, headings, tags) plus the body and one link doc per
 * external URL; anything else becomes a single attachment doc.
 */
export async function extractDocs(app: App, file: TFile): Promise<IndexedDoc[]> {
	const doc = emptyDoc(file);
	if (doc.kind !== "note") return [attachmentDoc(file)];

	// Read metadata from the cache rather than re-parsing: by the time
	// metadataCache fires 'changed' this is already up to date.
	const cache = app.metadataCache.getFileCache(file);
	const aliases = parseFrontMatterAliases(cache?.frontmatter) ?? [];
	doc.aliasList = aliases;
	doc.aliases = aliases.join(" ");
	doc.headings = (cache?.headings ?? []).map((heading) => heading.heading).join(" ");
	doc.tagList = (cache ? (getAllTags(cache) ?? []) : []).map((tag) => tag.replace(/^#/, ""));
	doc.tags = doc.tagList.join(" ");
	const body = (await app.vault.cachedRead(file)).slice(0, MAX_BODY_LENGTH);
	doc.body = body;

	const docs: IndexedDoc[] = [doc];
	for (const link of extractExternalLinks(body).slice(0, MAX_LINKS_PER_NOTE)) {
		docs.push({
			...emptyDoc(file),
			id: `${file.path}::L${link.offset}`,
			kind: "link",
			basename: link.text.length > 0 ? link.text : labelForUrl(link.url),
			url: link.url,
			line: link.line,
		});
	}
	return docs;
}

// ------------------------------------------------------------ external links

/**
 * Every external URL becomes its own doc, so "where did I save that link
 * again?" is answerable — that is what the `l ` operator in core/query.ts
 * narrows to.
 */
export interface ExtractedLink {
	url: string;
	/** Display text of the link; "" for bare/auto links. */
	text: string;
	/** Character offset within the note — the stable part of the doc id. */
	offset: number;
	/** 0-based line number, for jump-to-location. */
	line: number;
}

/** `[text](https://…)` — group 1 is the image `!`, kept to skip embeds. */
const MD_LINK_RE = /(!?)\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
/** `<https://…>` autolinks. */
const AUTOLINK_RE = /<(https?:\/\/[^>\s]+)>/g;
/** Bare URLs; trailing punctuation is trimmed afterwards. */
const BARE_URL_RE = /https?:\/\/[^\s<>"'\])}]+/g;

export function extractExternalLinks(markdown: string): ExtractedLink[] {
	const links: ExtractedLink[] = [];
	/** [start, end) ranges already consumed by a structured link form. */
	const taken: Array<[number, number]> = [];

	for (const match of markdown.matchAll(MD_LINK_RE)) {
		const offset = match.index;
		if (offset === undefined) continue;
		const [full, bang, text, url] = match;
		taken.push([offset, offset + full.length]);
		if (bang === "!") continue; // image embed, not a link
		if (url === undefined) continue;
		links.push({ url, text: (text ?? "").trim(), offset, line: 0 });
	}

	for (const match of markdown.matchAll(AUTOLINK_RE)) {
		const offset = match.index;
		if (offset === undefined || isTaken(taken, offset)) continue;
		taken.push([offset, offset + match[0].length]);
		const url = match[1];
		if (url === undefined) continue;
		links.push({ url, text: "", offset, line: 0 });
	}

	for (const match of markdown.matchAll(BARE_URL_RE)) {
		const offset = match.index;
		if (offset === undefined || isTaken(taken, offset)) continue;
		links.push({ url: match[0].replace(/[.,;:!?]+$/, ""), text: "", offset, line: 0 });
	}

	links.sort((a, b) => a.offset - b.offset);
	assignLines(markdown, links);
	return links;
}

function isTaken(taken: ReadonlyArray<[number, number]>, offset: number): boolean {
	return taken.some(([start, end]) => offset >= start && offset < end);
}

/** Single pass over the text; `links` must already be sorted by offset. */
function assignLines(markdown: string, links: ExtractedLink[]): void {
	let line = 0;
	let scanned = 0;
	for (const link of links) {
		for (let i = scanned; i < link.offset; i++) {
			if (markdown.charCodeAt(i) === 10) line += 1;
		}
		scanned = link.offset;
		link.line = line;
	}
}

/** Compact label for a bare URL: host + trimmed path. */
export function labelForUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const path = parsed.pathname === "/" ? "" : parsed.pathname;
		return `${parsed.hostname}${path}`;
	} catch {
		return url;
	}
}
