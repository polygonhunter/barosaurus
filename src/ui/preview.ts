import {
	Component,
	MarkdownRenderer,
	Platform,
	loadPdfJs,
	setIcon,
	type App,
	type TFile,
} from "obsidian";
import { excerptAround, excerptFollowsWords } from "../core/excerpt";
import { kindForExtension } from "../core/index-types";
import { findFolded, fold } from "../core/normalize";
import type { OmniItem, ResultKind } from "../core/types";
import { iconForResultKind } from "./icons";

/**
 * The preview pane: what the highlighted result actually is, rendered beside
 * the list.
 *
 * Three patterns here are load-bearing rather than decorative, and all three
 * come from the sibling plugin having got them wrong first:
 *
 *  1. A monotonic **token**. Every render is built into a DETACHED element and
 *     swapped in only if it is still the newest one. Holding ↓ fires a dozen
 *     overlapping `cachedRead`s, and without the token the slowest one wins —
 *     the preview then shows a note three rows above where the selection is.
 *
 *  2. A **Component per render**. `MarkdownRenderer.render` needs an owner to
 *     register its children on (embeds, dataview blocks, math). Without one it
 *     leaks every rendered subtree for the lifetime of the app; without
 *     unloading the previous one first, it leaks one per keystroke.
 *
 *  3. `cachedRead`, never `read`. The vault already holds the note; `read`
 *     goes back to disk on every arrow key.
 *
 * The pane renders nothing at all for anything that is not a file on disk, and
 * the caller decides whether it exists in the first place — phones never mount
 * one, because there is no room for it.
 */

/** Highlight at most this many matches (degenerate-query protection). */
const MAX_MARKS = 40;
/**
 * A new target is rendered only once the selection rests this long. Holding ↓
 * used to start a read and a full markdown render for every row it passed.
 */
const SHOW_DELAY_MS = 80;
/** Per text node, so one pathological line cannot spin the splitter. */
const MAX_SPLITS_PER_NODE = 20;
/**
 * Above this, counting a PDF's pages means pulling the whole binary through
 * `readBinary` on a keystroke. The page count is a nicety; the name, the size
 * and the date are the facts that matter, and they cost nothing.
 */
const MAX_PDF_BYTES_FOR_PAGE_COUNT = 12 * 1024 * 1024;

/**
 * Should the bar build a preview pane at all?
 *
 * Two conditions, and the phone one is not negotiable: the modal is already
 * effectively fullscreen there, so a 44% column would leave four results
 * visible. The CSS hides it as well, but hiding it is not the same as not
 * building it — an unmounted pane also means no `cachedRead`, no
 * MarkdownRenderer and no Component churn on a device that has the least to
 * spend on all three. Tablets keep the full desktop layout.
 */
export function shouldMountPreview(settings: { showPreview: boolean }): boolean {
	return settings.showPreview && !Platform.isPhone;
}

/** What the pane needs to know. Derived from an item, never from the DOM. */
export interface PreviewTarget {
	path: string;
	kind: ResultKind;
	/** Line to centre the excerpt on — a heading, a block, a full-text hit. */
	line?: number;
}

/**
 * The previewable shape of an item, or null when there is nothing to show.
 *
 * Commands, tags, folders and rows that promise a note which does not exist
 * yet all return null: a pane that renders "nothing here" for half the list is
 * worse than a pane that gets out of the way.
 */
export function previewTargetFor(item: OmniItem): PreviewTarget | null {
	switch (item.kind) {
		case "file":
			// A full-text hit on a link inside a note is that NOTE, opened at the
			// link's line — not a generic "MD · 3 KB" file card.
			return {
				path: item.path,
				kind: item.resultKind === "link" ? resultKindForPath(item.path) : item.resultKind,
				line: item.line,
			};
		case "heading":
		case "block":
			return { path: item.path, kind: "note", line: item.line };
		case "bookmark":
		case "tab":
			return item.path === undefined
				? null
				: { path: item.path, kind: resultKindForPath(item.path) };
		case "command":
		case "action":
		case "folder":
		case "tag":
		case "ghost":
		case "create":
			return null;
	}
}

function resultKindForPath(path: string): ResultKind {
	// Only markdown goes down the render path: a canvas is JSON, and handing it
	// to MarkdownRenderer prints the raw document. Same table the index uses.
	return kindForExtension(extensionOf(path));
}

function extensionOf(path: string): string {
	const dot = path.lastIndexOf(".");
	return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

/** The slice of pdf.js' loading task the page count needs. */
interface PdfCountTask {
	promise: Promise<{ numPages: number }>;
	/** Destroys the loading task AND the document it produced. */
	destroy(): Promise<void>;
}

export class PreviewPane {
	private component: Component | null = null;
	private token = 0;
	/**
	 * `path|line|mtime` of what is on screen. Typing narrows the list without
	 * moving the selection, and re-rendering the same note per keystroke only
	 * to move the highlights was the pane's most common waste.
	 */
	private lastKey: string | null = null;
	/**
	 * The query words the excerpt on screen was cut around, or null when the
	 * cut does not depend on them (short note, or centred on a line). A long
	 * note without a line must move its window to the new match.
	 */
	private lastWords: string | null = null;
	/** The rendered note body, so highlights can be redone in place. */
	private noteEl: HTMLElement | null = null;
	/** `path:mtime` → page count, so a second look at a PDF is free. */
	private readonly pdfPages = new Map<string, number>();

	constructor(
		private readonly app: App,
		private readonly el: HTMLElement,
		/** Layout hook: lets the modal give the list the full width when empty. */
		private readonly onEmptyChange?: (empty: boolean) => void,
	) {
		el.addClass("barosaurus-preview");
		el.addClass("is-empty");
		onEmptyChange?.(true);
	}

	/**
	 * Tear down for good. Bumping the token first is the point: a render that
	 * is already awaiting `cachedRead` must not write into an element the modal
	 * has closed.
	 */
	destroy(): void {
		this.token += 1;
		this.component?.unload();
		this.component = null;
		this.lastKey = null;
		this.lastWords = null;
		this.noteEl = null;
	}

	/**
	 * Keep the pane's column even while it shows nothing. The modal decides
	 * this per result LIST: deciding it per selection made the list jump
	 * between full and partial width as the arrow keys passed a command row.
	 */
	setReserved(reserved: boolean): void {
		this.el.toggleClass("is-reserved", reserved);
	}

	clear(): void {
		this.destroy();
		this.el.empty();
		this.el.addClass("is-empty");
		this.onEmptyChange?.(true);
	}

	/** Convenience for the modal, which holds items rather than targets. */
	async show(item: OmniItem, queryWords: readonly string[] = []): Promise<void> {
		const target = previewTargetFor(item);
		if (target === null) {
			this.clear();
			return;
		}
		await this.showTarget(target, queryWords);
	}

	async showTarget(target: PreviewTarget, queryWords: readonly string[] = []): Promise<void> {
		const token = ++this.token;
		const file = this.app.vault.getFileByPath(target.path);
		if (file === null) {
			this.clear();
			return;
		}

		// Already on screen: only the highlights can have changed.
		const key = `${target.path}|${target.line ?? ""}|${file.stat.mtime}`;
		const words = queryWords.map((word) => word.toLowerCase()).join("\u0000");
		if (key === this.lastKey && (this.lastWords === null || this.lastWords === words)) {
			if (this.noteEl !== null) {
				unmarkMatches(this.noteEl);
				markMatches(this.noteEl, queryWords);
			}
			return;
		}

		// Let the selection come to rest before reading and rendering.
		await new Promise((resolve) => window.setTimeout(resolve, SHOW_DELAY_MS));
		if (token !== this.token) return;

		// Built detached, swapped in only if still current. Created from THIS
		// element's document so a popout window's preview belongs to the popout.
		// Not createDiv(): that is declared on Node and APPENDS to it, which is
		// exactly what must not happen here. The lint rule prefers it anyway.
		const next = this.el.doc.createElement("div");
		/** The owner of THIS render's rendered subtree, adopted only on swap-in. */
		let owner: Component | null = null;
		/** Set by buildNote: whether this excerpt was cut around the words. */
		const excerptInfo = { followsWords: false };
		try {
			switch (target.kind) {
				case "note":
					owner = await this.buildNote(next, file, queryWords, target.line, token, excerptInfo);
					break;
				case "image":
					this.buildImage(next, file);
					break;
				case "link":
				case "file":
					this.buildFile(next, file);
					break;
			}
		} catch (error) {
			console.error("Barosaurus: could not build the preview", error);
			owner?.unload();
			owner = null;
			next.empty();
			next.createDiv({ cls: "barosaurus-preview-note", text: "Nothing to preview." });
		}
		if (token !== this.token) {
			// Overtaken while reading or rendering. Unload OUR component, never
			// the one that owns what is currently on screen — swapping
			// `this.component` before the swap-in is how the sibling ends up
			// tearing down the live preview's embeds from a stale render.
			owner?.unload();
			return;
		}

		this.el.empty();
		this.component?.unload();
		this.component = owner;
		this.el.removeClass("is-empty");
		this.onEmptyChange?.(false);
		while (next.firstChild !== null) this.el.appendChild(next.firstChild);
		this.el.createDiv({ cls: "barosaurus-preview-path", text: target.path });
		this.lastKey = key;
		this.lastWords = excerptInfo.followsWords ? words : null;
		this.noteEl = this.el.querySelector<HTMLElement>(".barosaurus-preview-note");

		// Cheap-enough facts that need their own read land afterwards, still
		// guarded by the token so a stale answer is dropped rather than shown.
		if (extensionOf(file.path) === "pdf") void this.appendPdfPages(file, token);
	}

	// -------------------------------------------------------------- builders

	/**
	 * Returns the Component that owns what it rendered, for the caller to adopt
	 * on swap-in. `MarkdownRenderer.render` registers embeds, math and code
	 * blocks on that owner and leaks all of them without one; one owner per
	 * render is what keeps a thousand arrow presses from accumulating a
	 * thousand live subtrees.
	 */
	private async buildNote(
		el: HTMLElement,
		file: TFile,
		queryWords: readonly string[],
		line: number | undefined,
		token: number,
		excerptInfo: { followsWords: boolean },
	): Promise<Component | null> {
		const body = await this.app.vault.cachedRead(file);
		// Bail before spending a render on an answer nobody is waiting for.
		if (token !== this.token) return null;
		// The line came from the whole file; the excerpt sees the body without
		// its frontmatter, so shift it by the lines that were cut — or a
		// heading result previewed the text N lines below the heading.
		const { body: content, lines: cut } = stripFrontmatter(body);
		const bodyLine = line === undefined || line < cut ? undefined : line - cut;
		const excerpt = excerptAround(content, queryWords, bodyLine);
		excerptInfo.followsWords = excerptFollowsWords(content, bodyLine);
		const contentEl = el.createDiv({ cls: "barosaurus-preview-note markdown-rendered" });
		const owner = new Component();
		owner.load();
		await MarkdownRenderer.render(this.app, excerpt, contentEl, file.path, owner);
		markMatches(contentEl, queryWords);
		return owner;
	}

	private buildImage(el: HTMLElement, file: TFile): void {
		const wrap = el.createDiv({ cls: "barosaurus-preview-image" });
		wrap.createEl("img", {
			// Decoded off the main thread; the pane must not stall the arrow keys.
			attr: { src: this.app.vault.getResourcePath(file), alt: file.name, decoding: "async" },
		});
		wrap.createDiv({
			cls: "barosaurus-preview-meta",
			text: `${formatSize(file.stat.size)} · ${formatDay(file.stat.mtime)}`,
		});
	}

	private buildFile(el: HTMLElement, file: TFile): void {
		const wrap = el.createDiv({ cls: "barosaurus-preview-file" });
		const glyph = wrap.createDiv({ cls: "barosaurus-preview-icon" });
		setIcon(glyph, extensionOf(file.path) === "pdf" ? "file-text" : iconForResultKind("file"));
		wrap.createDiv({ cls: "barosaurus-preview-name", text: file.name });
		wrap.createDiv({
			cls: "barosaurus-preview-meta",
			text: `${file.extension.toUpperCase()} · ${formatSize(file.stat.size)} · ${formatDay(
				file.stat.mtime,
			)}`,
		});
		// Filled in by appendPdfPages when the file is small enough to read.
		wrap.createDiv({ cls: "barosaurus-preview-pages" });
	}

	/**
	 * Page count for a PDF, appended once it is known. Deliberately after the
	 * swap-in: pdf.js has to parse the whole document, which is far too slow to
	 * hold a keystroke-driven preview behind.
	 */
	private async appendPdfPages(file: TFile, token: number): Promise<void> {
		if (file.stat.size > MAX_PDF_BYTES_FOR_PAGE_COUNT) return;
		// Keyed on mtime so an edited PDF is counted again, and so a second pass
		// down the same folder costs nothing.
		const key = `${file.path}:${file.stat.mtime}`;
		let pages = this.pdfPages.get(key);
		if (pages === undefined) {
			let task: PdfCountTask | null = null;
			try {
				const pdfjs = (await loadPdfJs()) as {
					getDocument(options: { data: ArrayBuffer }): PdfCountTask;
				};
				const data = await this.app.vault.readBinary(file);
				task = pdfjs.getDocument({ data });
				pages = (await task.promise).numPages;
				this.pdfPages.set(key, pages);
			} catch (error) {
				// Encrypted or malformed PDFs simply have no page count to show.
				console.error("Barosaurus: could not read the PDF page count", error);
				return;
			} finally {
				// Only the count was wanted; the parsed document (and pdf.js'
				// worker-side copy of the binary) must not outlive it.
				if (task) void task.destroy().catch(() => undefined);
			}
		}
		if (token !== this.token) return;
		const slot = this.el.querySelector<HTMLElement>(".barosaurus-preview-pages");
		if (slot === null) return;
		slot.setText(`${pages} ${pages === 1 ? "page" : "pages"}`);
	}
}

// ------------------------------------------------------------------ excerpt

/** Leading YAML block, LF or CRLF — notes synced from Windows carry CRLF. */
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** The note without its frontmatter, and how many lines that removed. */
export function stripFrontmatter(text: string): { body: string; lines: number } {
	const match = FRONTMATTER_RE.exec(text);
	if (match === null) return { body: text, lines: 0 };
	let lines = 0;
	for (const ch of match[0]) if (ch === "\n") lines += 1;
	return { body: text.slice(match[0].length), lines };
}

export { excerptAround };

/**
 * Wrap query-word occurrences in `<mark>` across the rendered DOM.
 *
 * A TreeWalker over `root.doc`, never the global `document`: in a popout
 * window the global belongs to the main window, and `createTreeWalker` on the
 * wrong document silently walks nothing. Splitting text nodes rather than
 * rewriting HTML is also what keeps this clear of innerHTML.
 */
function markMatches(root: HTMLElement, queryWords: readonly string[]): void {
	// Folded like the index folds them, and matched folded too (findFolded):
	// "strasse" must mark "Straße", and "über" must mark "über" at all.
	const words = queryWords.map(fold).filter((word) => word.length > 1 && !word.includes(" "));
	if (words.length === 0) return;

	const walker = root.doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const textNodes: Text[] = [];
	let node = walker.nextNode();
	while (node !== null) {
		textNodes.push(node as Text);
		node = walker.nextNode();
	}

	let marks = 0;
	for (const textNode of textNodes) {
		if (marks >= MAX_MARKS) break;
		let current = textNode;
		let guard = 0;
		while (marks < MAX_MARKS && guard < MAX_SPLITS_PER_NODE) {
			guard += 1;
			const found = findFolded(current.data, words);
			if (found === null) break;
			const [start, end] = found;
			const matchNode = current.splitText(start);
			const rest = matchNode.splitText(end - start);
			// Detached on purpose — see the note on the preview root above.
			const mark = root.doc.createElement("mark");
			mark.addClass("barosaurus-mark");
			matchNode.replaceWith(mark);
			mark.appendChild(matchNode);
			marks += 1;
			current = rest;
		}
	}
}

/** Undo markMatches: unwrap every mark and re-join the split text nodes. */
function unmarkMatches(root: HTMLElement): void {
	const parents = new Set<Node>();
	for (const mark of Array.from(root.querySelectorAll("mark.barosaurus-mark"))) {
		const parent = mark.parentNode;
		if (parent === null) continue;
		while (mark.firstChild !== null) parent.insertBefore(mark.firstChild, mark);
		parent.removeChild(mark);
		parents.add(parent);
	}
	for (const parent of parents) parent.normalize();
}

// ------------------------------------------------------------------ facts

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Local, short, and never a locale string written into a note — display only. */
function formatDay(epochMs: number): string {
	const date = new Date(epochMs);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleDateString();
}
