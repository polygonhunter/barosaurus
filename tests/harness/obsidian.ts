/**
 * A stand-in for the `obsidian` module, so `src/ui/**` can actually be RUN.
 *
 * Why this exists: `src/core/**` is obsidian-free by architecture rule and has
 * always been testable. The modal, the keyboard layer and the executor are not,
 * and for four releases nothing ever instantiated them — which is how a bar that
 * could not even open shipped with 585 green tests.
 *
 * The rule for this file: model the DOCUMENTED behaviour, plus the runtime
 * behaviour we have actually observed. Notably `Modal` assigns `win` and `doc`
 * onto the instance even though neither appears in the typings — that assignment
 * is what threw "Cannot set property win of #<OmnibarModal> which has only a
 * getter" in a real vault, so the fake does it too. A harness that is kinder
 * than reality tests nothing.
 */

export type PaneType = "tab" | "split" | "window";

export interface Instruction {
	command: string;
	purpose: string;
}

export interface SearchResult {
	score: number;
	matches: [number, number][];
}

export interface SearchResultContainer {
	match: SearchResult;
}

// --------------------------------------------------------------- primitives

export const apiVersion = "1.12.4";

export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export class Notice {
	static shown: string[] = [];
	constructor(message: string | DocumentFragment) {
		Notice.shown.push(String(message));
	}
	setMessage(): this {
		return this;
	}
	hide(): void {
		/* nothing to hide in a fake */
	}
}

export const Platform = {
	isDesktop: true,
	isDesktopApp: true,
	isMobile: false,
	isPhone: false,
	isTablet: false,
	isMacOS: true,
	isWin: false,
	isLinux: false,
};

export function debounce<T extends unknown[]>(
	fn: (...args: T) => unknown,
	_timeout?: number,
	_immediate?: boolean,
): ((...args: T) => void) & { cancel(): void; run(): void } {
	// Synchronous on purpose: a test that has to wait on a timer is a test that
	// will one day be flaky.
	const wrapped = (...args: T): void => void fn(...args);
	return Object.assign(wrapped, { cancel: () => undefined, run: () => undefined });
}

// ------------------------------------------------------------------ search

function simpleMatch(query: string, text: string): SearchResult | null {
	const at = text.toLowerCase().indexOf(query.toLowerCase());
	if (query.length === 0) return { score: 0, matches: [] };
	if (at < 0) return null;
	return { score: -at, matches: [[at, at + query.length]] };
}

export function prepareSimpleSearch(query: string): (text: string) => SearchResult | null {
	return (text: string) => simpleMatch(query, text);
}

export function prepareFuzzySearch(query: string): (text: string) => SearchResult | null {
	return (text: string) => {
		const direct = simpleMatch(query, text);
		if (direct !== null) return direct;
		// Scattered subsequence, the cheap approximation of what Obsidian does.
		const lower = text.toLowerCase();
		let at = 0;
		const matches: [number, number][] = [];
		for (const ch of query.toLowerCase()) {
			const found = lower.indexOf(ch, at);
			if (found < 0) return null;
			matches.push([found, found + 1]);
			at = found + 1;
		}
		return { score: -text.length, matches };
	};
}

export function renderResults(el: HTMLElement, text: string, _result: SearchResult | null): void {
	el.textContent = text;
}

export function setIcon(el: HTMLElement, icon: string): void {
	el.setAttribute("data-icon", icon);
}

// ------------------------------------------------------------------ keymap

type KeymapHandler = (evt: KeyboardEvent, ctx: { key: string }) => boolean | void;

interface Registered {
	modifiers: readonly string[];
	key: string | null;
	handler: KeymapHandler;
}

export class Scope {
	readonly registered: Registered[] = [];
	constructor(readonly parent?: Scope) {}

	register(modifiers: readonly string[] | null, key: string | null, handler: KeymapHandler) {
		const entry: Registered = { modifiers: modifiers ?? [], key, handler };
		this.registered.push(entry);
		return entry;
	}

	unregister(entry: unknown): void {
		const at = this.registered.indexOf(entry as Registered);
		if (at >= 0) this.registered.splice(at, 1);
	}

	/**
	 * First matching handler wins and a `false` return means "handled, stop" —
	 * the same contract the real Scope documents, and the one the bar's key
	 * registrations lean on.
	 */
	handle(evt: KeyboardEvent): boolean {
		const mods = new Set<string>();
		if (evt.metaKey || evt.ctrlKey) mods.add("Mod");
		if (evt.ctrlKey) mods.add("Ctrl");
		if (evt.altKey) mods.add("Alt");
		if (evt.shiftKey) mods.add("Shift");

		for (const entry of this.registered) {
			if (entry.key !== null && entry.key.toLowerCase() !== evt.key.toLowerCase()) continue;
			const wanted = new Set(entry.modifiers);
			// Exact modifier match, so ⌘↵ does not also fire the bare ↵ handler.
			if (wanted.size !== mods.size) continue;
			let same = true;
			for (const m of wanted) if (!mods.has(m)) same = false;
			if (!same) continue;
			const result = entry.handler(evt, { key: evt.key });
			if (result === false) return true;
		}
		return false;
	}
}

export const Keymap = {
	isModifier(evt: KeyboardEvent | MouseEvent, modifier: string): boolean {
		if (modifier === "Mod") return evt.metaKey || evt.ctrlKey;
		if (modifier === "Shift") return evt.shiftKey;
		if (modifier === "Alt") return evt.altKey;
		if (modifier === "Ctrl") return evt.ctrlKey;
		return false;
	},
	isModEvent(evt?: KeyboardEvent | MouseEvent | null): PaneType | boolean {
		if (evt === null || evt === undefined) return false;
		const mod = evt.metaKey || evt.ctrlKey;
		if (!mod) return false;
		if (evt.altKey && evt.shiftKey) return "window";
		if (evt.altKey) return "split";
		return "tab";
	},
};

// --------------------------------------------------------------- vault bits

export class TAbstractFile {
	path = "";
	name = "";
	parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
	basename = "";
	extension = "md";
	stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
	isRoot(): boolean {
		return this.path === "/";
	}
}

export function getAllTags(): string[] | null {
	return [];
}

export function parseFrontMatterAliases(): string[] | null {
	return null;
}

export async function loadPdfJs(): Promise<unknown> {
	throw new Error("loadPdfJs is not available in the harness");
}

export async function requestUrl(): Promise<never> {
	throw new Error("the harness makes no network requests");
}

export class Component {
	load(): void {}
	unload(): void {}
	onload(): void {}
	onunload(): void {}
	registerEvent(): void {}
	addChild<T>(child: T): T {
		return child;
	}
}

export const MarkdownRenderer = {
	async render(): Promise<void> {},
};

export class MarkdownView extends Component {}
export class Editor {}
export interface Command {
	id: string;
	name: string;
	icon?: string;
	callback?: () => unknown;
	checkCallback?: (checking: boolean) => boolean | void;
}

export class Plugin extends Component {}
export class PluginSettingTab {
	constructor(
		readonly app: unknown,
		readonly plugin: unknown,
	) {}
	display(): void {}
}
export class Setting {
	constructor(readonly containerEl: HTMLElement) {}
	setName(): this {
		return this;
	}
	setDesc(): this {
		return this;
	}
	setHeading(): this {
		return this;
	}
	addButton(): this {
		return this;
	}
	addToggle(): this {
		return this;
	}
	addSlider(): this {
		return this;
	}
	addText(): this {
		return this;
	}
	addTextArea(): this {
		return this;
	}
	addDropdown(): this {
		return this;
	}
}

// ------------------------------------------------------------------- modal

export class Modal {
	readonly containerEl: HTMLElement;
	readonly modalEl: HTMLElement;
	readonly titleEl: HTMLElement;
	readonly contentEl: HTMLElement;
	readonly scope: Scope;

	constructor(readonly app: unknown) {
		const doc = globalThis.document;
		this.containerEl = doc.createElement("div");
		this.modalEl = doc.createElement("div");
		this.titleEl = doc.createElement("div");
		this.contentEl = doc.createElement("div");
		this.containerEl.appendChild(this.modalEl);
		this.modalEl.appendChild(this.titleEl);
		this.modalEl.appendChild(this.contentEl);
		this.scope = new Scope();

		// THE assignment that broke the real plugin. Obsidian does this and the
		// typings do not mention it, so a getter-only `win` on a subclass throws
		// right here. Keep it.
		(this as unknown as { win: Window }).win = doc.defaultView as Window;
		(this as unknown as { doc: Document }).doc = doc;
	}

	open(): void {
		globalThis.document.body.appendChild(this.containerEl);
		this.onOpen();
	}

	close(): void {
		this.containerEl.remove();
		this.onClose();
	}

	onOpen(): void {}
	onClose(): void {}
}

// ------------------------------------------------------------ suggest modal

export abstract class SuggestModal<T> extends Modal {
	readonly inputEl: HTMLInputElement;
	readonly resultContainerEl: HTMLElement;
	limit = 50;
	emptyStateText = "No results.";

	/** Rendered values, index-aligned with the `.suggestion-item` elements. */
	private values: T[] = [];
	private selected = -1;

	constructor(app: unknown) {
		super(app);
		const doc = globalThis.document;
		this.inputEl = doc.createElement("input");
		this.resultContainerEl = doc.createElement("div");
		this.contentEl.appendChild(this.inputEl);
		this.contentEl.appendChild(this.resultContainerEl);

		// Obsidian drives the list from the input's own events, and its keymap
		// runs at the document level — which is why a synthetic, bubbling
		// keydown dispatched on inputEl reaches it. Mirrored here so the bar's
		// re-dispatch trick is exercised rather than assumed.
		this.inputEl.addEventListener("input", () => void this.updateSuggestions());
		this.containerEl.addEventListener("keydown", (evt) => this.onKeyDown(evt));
	}

	abstract getSuggestions(query: string): T[] | Promise<T[]>;
	abstract renderSuggestion(value: T, el: HTMLElement): void;
	abstract onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void;

	onNoSuggestion(): void {
		this.resultContainerEl.empty();
		const el = globalThis.document.createElement("div");
		el.addClass("suggestion-empty");
		el.textContent = this.emptyStateText;
		this.resultContainerEl.appendChild(el);
	}

	setPlaceholder(text: string): void {
		this.inputEl.placeholder = text;
	}

	setInstructions(): void {}

	override open(): void {
		super.open();
		void this.updateSuggestions();
	}

	/** Re-run the query and repaint. Undocumented in the typings; real. */
	async updateSuggestions(): Promise<void> {
		const values = await this.getSuggestions(this.inputEl.value);
		this.values = values.slice(0, this.limit);
		this.resultContainerEl.empty();
		if (this.values.length === 0) {
			this.selected = -1;
			this.onNoSuggestion();
			return;
		}
		for (const value of this.values) {
			const el = globalThis.document.createElement("div");
			el.addClass("suggestion-item");
			this.renderSuggestion(value, el);
			this.resultContainerEl.appendChild(el);
		}
		this.setSelected(0);
	}

	private itemEls(): HTMLElement[] {
		return Array.from(this.resultContainerEl.querySelectorAll<HTMLElement>(".suggestion-item"));
	}

	private setSelected(index: number): void {
		const els = this.itemEls();
		if (els.length === 0) {
			this.selected = -1;
			return;
		}
		const next = ((index % els.length) + els.length) % els.length;
		els.forEach((el, i) => el.toggleClass("is-selected", i === next));
		this.selected = next;
		// Obsidian notifies subclasses through a DOM mutation, which is what the
		// bar's MutationObserver watches. Appending/removing the class above is
		// that mutation.
	}

	private onKeyDown(evt: KeyboardEvent): void {
		if (this.scope.handle(evt)) return;
		if (evt.defaultPrevented) return;

		if (evt.key === "ArrowDown") {
			this.setSelected(this.selected + 1);
			return;
		}
		if (evt.key === "ArrowUp") {
			this.setSelected(this.selected - 1);
			return;
		}
		if (evt.key === "Enter") {
			this.selectActiveSuggestion(evt);
			return;
		}
		if (evt.key === "Escape") {
			this.close();
		}
	}

	selectActiveSuggestion(evt: KeyboardEvent | MouseEvent): void {
		const value = this.values[this.selected];
		if (value === undefined) return;
		this.selectSuggestion(value, evt);
	}

	selectSuggestion(value: T, evt: KeyboardEvent | MouseEvent): void {
		this.onChooseSuggestion(value, evt);
		this.close();
	}

	// ---- helpers the tests use, not part of the real API

	/** Index of the highlighted row, or -1. */
	get harnessSelectedIndex(): number {
		return this.selected;
	}

	/** The highlighted element, for asserting what the user would see. */
	get harnessSelectedEl(): HTMLElement | undefined {
		return this.itemEls()[this.selected];
	}
}
