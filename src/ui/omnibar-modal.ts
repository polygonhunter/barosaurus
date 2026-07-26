import {
	Keymap,
	prepareFuzzySearch,
	SuggestModal,
	type App,
	type Instruction,
	type PaneType,
	type SearchResult,
	type SearchResultContainer,
} from "obsidian";
import { withoutHidden } from "../core/actions";
import { groupRows, type GroupedRows, type GroupingOptions } from "../core/grouping";
import {
	breadcrumbs,
	collectedValues,
	createStack,
	current,
	isRoot,
	pop,
	push,
	resolveBack,
	setQuery as setPageQuery,
	setValue as setPageValue,
	type PageStackState,
} from "../core/pagestack";
import { foldedWords } from "../core/normalize";
import { isEmptyQuery, parseQuery, type ParsedQuery, type QueryScope } from "../core/query";
import { rankCandidates, type RankOptions } from "../core/rank";
import {
	EMPTY_CONTEXT,
	isGroupHeader,
	type BarContext,
	type Candidate,
	type OmniItem,
	type OmniRow,
} from "../core/types";
import { dedupeFullText } from "../sources/fulltext";
import {
	isStreaming,
	type FullTextIndex,
	type Source,
	type SourceContext,
	type SourceSettings,
	type StreamingSource,
} from "../sources/source";
import type { ActionController } from "./action-panel";
import type { BarPage, BarSurface } from "./picker";
import { SelectionPill } from "./pill";
import { PreviewPane, shouldMountPreview } from "./preview";
import { renderRow } from "./render";
import { forceUpdateSuggestions } from "./unsafe";

/** How long the entrance stagger class stays on (first paint only). */
const ENTER_DURATION_MS = 450;
/** Default upper bound handed to every source. */
const DEFAULT_SOURCE_LIMIT = 60;
/** Direct-pick shortcuts: ⌘1–9. */
const DIRECT_PICK_COUNT = 9;
/**
 * How often the selection may be nudged off a group overline before we give
 * up. One is always enough — a header is never the last row and never follows
 * another header — so this only exists to make a wrong assumption cheap.
 */
const HEADER_NUDGE_BUDGET = 3;

const DEFAULT_INSTRUCTIONS: Instruction[] = [
	{ command: "↑↓", purpose: "Navigate" },
	{ command: "↵", purpose: "Open" },
	{ command: "⌘K", purpose: "Actions" },
	{ command: "⌘↵", purpose: "New tab" },
	{ command: "⌘1–9", purpose: "Pick directly" },
	{ command: "esc", purpose: "Back" },
];

/** While a page is on top, most of the root layer means nothing. */
const PAGE_INSTRUCTIONS: Instruction[] = [
	{ command: "↑↓", purpose: "Navigate" },
	{ command: "↵", purpose: "Choose" },
	{ command: "esc", purpose: "Back" },
];

/** Sentence case, like every label in the bar. */
const SCOPE_LABELS: Record<QueryScope, string> = {
	all: "",
	command: "Commands",
	symbol: "This note",
	line: "Go to line",
};

export interface OmnibarOptions {
	/**
	 * Everything that may answer a query. Injected rather than constructed:
	 * the bar owns no source, so it can be driven by fixtures in tests and by
	 * the real registry in the plugin.
	 */
	sources: readonly (Source | StreamingSource)[];
	/** The editing situation, re-read on every keystroke. */
	context?: () => BarContext;
	/** Frecency and pins, re-read on every keystroke. */
	rankOptions?: () => RankOptions;
	/**
	 * Per-item boosts from the editing situation — the reason "b" finds Bold
	 * while text is selected. It has to be a callback rather than a value on
	 * RankOptions because it needs the candidate list, which only exists here.
	 * Omitted when the user has switched context ranking off.
	 */
	contextBoostFor?: (items: readonly OmniItem[], ctx: BarContext) => Record<string, number>;
	/** Group order and caps. */
	grouping?: GroupingOptions;
	/** Upper bound handed to each source. */
	sourceLimit?: number;
	/** Render the highlighted result beside the list. Never on a phone. */
	showPreview?: boolean;
	/**
	 * Read handle on the full-text index. A callback, like `context` and
	 * `rankOptions`, so the index that exists on the next keystroke is the one
	 * the sources see — the plugin builds it asynchronously after layout.
	 */
	index?: () => FullTextIndex | null;
	/** The settings slice the sources read (exclusions, hidden commands). */
	settings?: () => SourceSettings;
	/** Synthetic "create from what you typed" row, folded in before grouping. */
	createItem?: (parsed: ParsedQuery) => OmniItem | null;
	/**
	 * What Enter and the ⌘-modified Enters do. `paneType` is whatever
	 * `Keymap.isModEvent` returned — `false` for none, otherwise a PaneType —
	 * and both `workspace.getLeaf()` and `openLinkText()` take exactly that,
	 * so it is passed straight through instead of being narrowed to "tab".
	 */
	onChoose?: (
		item: OmniItem,
		evt: MouseEvent | KeyboardEvent,
		paneType: PaneType | boolean,
	) => void;
	/** Named action on the highlighted item — Tab runs "insert-link". */
	onAction?: (actionId: string, item: OmniItem, evt: KeyboardEvent) => void;
	/**
	 * The ⌘K panel, the multi-step flows, ⌘P and the ↑ history. Absent means
	 * none of it exists: the bar stays a finder, and every key that would have
	 * driven it does nothing instead of half-working.
	 */
	actions?: ActionController;
	placeholder?: string;
	instructions?: Instruction[];
}

/**
 * The bar.
 *
 * Heterogeneous rows (commands, files, headings, tags, group labels) rule out
 * FuzzySuggestModal, which owns both the matching and the item type; we extend
 * SuggestModal so sources keep their own recall and the ranker keeps the
 * cross-source comparison. SuggestModal also permits an async getSuggestions,
 * which is what lets a streaming source fold in behind the sync ones.
 */
/**
 * A window we can also construct events from.
 *
 * `Window` in lib.dom carries no constructor properties, so `win.Event` does
 * not typecheck against it — the previous spelling reached for
 * `typeof globalThis` to get them, which is the identifier the popout-safety
 * lint rule bans. Naming the two constructors we actually use is narrower and
 * says why they are here. They must come from THIS window: an event built with
 * another window's constructor is not one a popout's document will accept.
 */
interface EventCapableWindow extends Window {
	Event: typeof Event;
	KeyboardEvent: typeof KeyboardEvent;
}

export class OmnibarModal extends SuggestModal<OmniRow> {
	private readonly options: OmnibarOptions;
	private readonly pill: SelectionPill;
	private readonly breadcrumbEl: HTMLElement;
	private readonly statusEl: HTMLElement;
	/** Null when the user switched the pane off, or on a phone. */
	private readonly preview: PreviewPane | null;
	private readonly selectionObserver: MutationObserver;

	private stack: PageStackState = createStack();
	/**
	 * The behaviour of each pushed level, index-aligned with
	 * `breadcrumbs(this.stack)`. The stack owns where you are; this owns what
	 * that level shows and what choosing a row on it means.
	 */
	private pages: BarPage[] = [];
	/** Where ↑ has walked to in the query history; -1 is the live input. */
	private historyIndex = -1;
	private rows: OmniRow[] = [];
	private items: OmniItem[] = [];
	/** item id → position among item rows; drives the ⌘1–9 chips. */
	private readonly ordinals = new Map<string, number>();
	/** item id → the SearchResult its source matched with, when it supplied one. */
	private matches = new Map<string, SearchResult>();
	/** Fallback highlighter for sources that supply no SearchResult. */
	private matcher: ((text: string) => SearchResult | null) | null = null;

	private queryToken = 0;
	private inflight: AbortController | null = null;
	private busy = false;
	private scopeLabel = "";

	private selectedIndex = 0;
	private lastDirection: 1 | -1 = 1;
	private headerNudges = 0;
	/** True while re-dispatching our own navigation keys, so we let them pass. */
	private synthetic = false;

	/** ⌘1–9 chips exist always and are revealed only while the modifier is held. */
	private readonly modHeld = (event: KeyboardEvent) => {
		if (event.key === "Meta" || event.key === "Control") {
			this.modalEl.toggleClass("mods-held", event.type === "keydown");
		}
	};

	constructor(app: App, options: OmnibarOptions) {
		super(app);
		this.options = options;
		this.modalEl.addClass("barosaurus-modal");
		this.setPlaceholder(options.placeholder ?? "Search, jump or do something…");
		this.emptyStateText = "No matches.";
		this.limit = DEFAULT_SOURCE_LIMIT;
		this.setInstructions(options.instructions ?? DEFAULT_INSTRUCTIONS);

		// Breadcrumb pills sit left of the input, inside its own container.
		const inputParent = this.inputEl.parentElement ?? this.modalEl;
		this.breadcrumbEl = createDiv({ cls: "barosaurus-breadcrumbs is-empty" });
		inputParent.insertBefore(this.breadcrumbEl, this.inputEl);

		// Insert relative to the result container's REAL parent — on mobile it
		// is not a direct child of modalEl, and inserting against the wrong
		// parent throws (which killed the sibling's modal on phones).
		const resultsParent = this.resultContainerEl.parentElement ?? this.modalEl;
		this.statusEl = createDiv({ cls: "barosaurus-status" });
		resultsParent.insertBefore(this.statusEl, this.resultContainerEl);

		// The pane sits beside the list, so both move into a flex wrapper. Same
		// rule as above: insert against the result container's real parent.
		if (shouldMountPreview({ showPreview: options.showPreview ?? true })) {
			const body = createDiv({ cls: "barosaurus-body" });
			resultsParent.insertBefore(body, this.resultContainerEl);
			body.appendChild(this.resultContainerEl);
			this.preview = new PreviewPane(app, body.createDiv(), (empty) =>
				this.modalEl.toggleClass("is-preview-empty", empty),
			);
		} else {
			this.preview = null;
		}

		this.pill = new SelectionPill(this.modalEl);

		// SuggestModal exposes no selection hook. The selected row is marked
		// with .is-selected, so watch class flips on the result container.
		this.selectionObserver = new MutationObserver(() => this.syncSelection());
		this.selectionObserver.observe(this.resultContainerEl, {
			subtree: true,
			childList: true,
			attributeFilter: ["class"],
		});

		this.registerKeys();
		// Capture phase: arrows must be decided BEFORE they reach the document,
		// where SuggestModal's own navigation would move one row — including
		// onto a group label.
		this.inputEl.addEventListener("keydown", this.onArrowCapture, true);
	}

	// ------------------------------------------------------------ lifecycle

	onOpen(): void {
		// Modal.onOpen is typed `Promise<void> | void`; `void` says we know and
		// are deliberately not sequencing against it.
		void super.onOpen();
		// Stagger the very first paint only — never on keystrokes.
		this.modalEl.addClass("is-entering");
		this.inputWin.setTimeout(() => this.modalEl.removeClass("is-entering"), ENTER_DURATION_MS);
		this.inputWin.addEventListener("keydown", this.modHeld);
		this.inputWin.addEventListener("keyup", this.modHeld);
		this.renderBreadcrumbs();
		this.pill.mount(this.resultContainerEl);
		// Populate the empty state immediately rather than after the first key.
		this.refresh();
	}

	onClose(): void {
		this.inputWin.removeEventListener("keydown", this.modHeld);
		this.inputWin.removeEventListener("keyup", this.modHeld);
		this.inputEl.removeEventListener("keydown", this.onArrowCapture, true);
		this.selectionObserver.disconnect();
		this.pill.destroy();
		this.preview?.destroy();
		this.inflight?.abort();
		this.inflight = null;
		super.onClose();
	}

	/**
	 * The input's own window. Never the bare global: in a popout window the
	 * globals belong to the main window and every listener misses.
	 *
	 * NOT named `win`. Modal assigns a `win` field on the instance at runtime —
	 * it is absent from the typings, so nothing static can see it — and a
	 * getter-only accessor of that name on our prototype turned that assignment
	 * into "Cannot set property win of #<OmnibarModal> which has only a getter",
	 * thrown inside the constructor. The bar could not open at all.
	 */
	private get inputWin(): EventCapableWindow {
		return this.inputEl.win as EventCapableWindow;
	}

	// ----------------------------------------------------------------- keys

	private registerKeys(): void {
		// ⌘K — the action panel for the highlighted row, pushed as a level of
		// this same bar. Registered FIRST so nothing else can claim the chord.
		this.scope.register(["Mod"], "k", () => {
			this.openActionPanel();
			return false;
		});

		// ⌘P — pin or unpin. It has to come before the Emacs Ctrl+P below,
		// because "Mod" IS Ctrl on Windows and Linux and the first matching
		// handler wins: pinning is the documented binding, Emacs navigation is
		// a nicety, so on those platforms Ctrl+P pins and ⌃N still steps down.
		this.scope.register(["Mod"], "p", () => {
			this.runOnActive("pin");
			return false;
		});

		// Emacs-style navigation, the same path the arrows take.
		this.scope.register(["Ctrl"], "n", () => {
			this.navigate(1);
			return false;
		});
		this.scope.register(["Ctrl"], "p", () => {
			this.navigate(-1);
			return false;
		});

		// Plain Enter is SuggestModal's own; these three only exist because a
		// registration with modifiers does not match one without them.
		// selectActiveSuggestion hands the very event to onChooseSuggestion, so
		// Keymap.isModEvent still sees ⌘ / ⌘⌥ / ⌘⌥⇧ there.
		for (const modifiers of [["Mod"], ["Mod", "Alt"], ["Mod", "Alt", "Shift"]] as const) {
			this.scope.register([...modifiers], "Enter", (event) => {
				this.selectActiveSuggestion(event);
				return false;
			});
		}

		// Tab inserts a link at the cursor — but only when that action really
		// applies to the highlighted row. On a command, a tag or a settings
		// page it does nothing VISIBLE rather than half-acting: returning false
		// still swallows the key, because the alternative is Tab moving focus
		// out of the input, which is the one outcome nobody wants.
		this.scope.register([], "Tab", (event) => {
			this.runOnActive("insert-link", event);
			return false;
		});

		for (let n = 1; n <= DIRECT_PICK_COUNT; n++) {
			this.scope.register(["Mod"], String(n), (event) => {
				const item = this.items[n - 1];
				if (item !== undefined) this.selectSuggestion(item, event);
				return false;
			});
		}

		// A KeymapEventListener returning false means preventDefault; returning
		// true lets Obsidian's own handling run. Both of these lean on that:
		// at the root there is nothing to pop, so the default (close for Esc,
		// nothing for Backspace) is exactly right.
		this.scope.register([], "Escape", () => {
			if (resolveBack(this.stack).action === "close") return true;
			this.popPage();
			return false;
		});
		this.scope.register([], "Backspace", () => {
			if (this.inputEl.value.length > 0) return true;
			if (resolveBack(this.stack).action === "close") return true;
			this.popPage();
			return false;
		});
	}

	/**
	 * Arrow keys, decided before SuggestModal sees them.
	 *
	 * Group labels are rendered as list rows, so the default one-row move can
	 * land on one. We swallow the real key and re-dispatch as many synthetic
	 * ones as it takes to land on an item — the move itself stays with
	 * Obsidian, because the chooser that owns the selection index is internal
	 * (it lives behind src/ui/unsafe.ts, another agent's file).
	 */
	private readonly onArrowCapture = (event: KeyboardEvent): void => {
		if (this.synthetic) return; // our own re-dispatch, let it through
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
			// Editing the text ends a history walk: the moment you change what
			// was recalled it is your query again, not an entry in a list.
			if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") {
				this.historyIndex = -1;
			}
			return;
		}

		const direction = event.key === "ArrowDown" ? 1 : -1;
		event.preventDefault();
		event.stopPropagation();

		// ↑ browses the history ONLY from an empty input — otherwise it is the
		// selection key it has always been. Once a walk has started it
		// continues in both directions, because the input is no longer empty
		// but the user is still browsing.
		if (this.browseHistory(direction)) return;
		this.navigate(direction);
	};

	/**
	 * One step through the query history. False means "this key was not for
	 * me", which is what puts the selection back in charge.
	 */
	private browseHistory(direction: 1 | -1): boolean {
		const actions = this.options.actions;
		if (actions === undefined) return false;
		if (!isRoot(this.stack)) return false;
		const walking = this.historyIndex >= 0;
		// ↑ from a typed query moves the selection; ↓ outside a walk likewise.
		if (!walking && (direction === 1 || this.inputEl.value.length > 0)) return false;

		// Up the list is BACK in time, so the arrow and the index run opposite.
		const next = actions.historyStep(this.historyIndex, direction === -1 ? 1 : -1);
		if (next === this.historyIndex) return true;
		this.historyIndex = next;
		this.setQuery(actions.historyQuery(next));
		return true;
	}

	private navigate(direction: 1 | -1): void {
		this.lastDirection = direction;
		this.headerNudges = 0;
		const rows = this.rowEls();
		if (rows.length === 0) return;
		const from = rows.findIndex((el) => el.hasClass("is-selected"));
		const next = wrapIndex(from + direction, rows.length);
		const landing = rows[next];
		// A label is never adjacent to another label, so two steps always clear it.
		this.step(direction, landing !== undefined && isHeaderEl(landing) ? 2 : 1);
	}

	/** Move the selection by re-dispatching the key Obsidian already handles. */
	private step(direction: 1 | -1, times: number): void {
		const key = direction > 0 ? "ArrowDown" : "ArrowUp";
		this.synthetic = true;
		for (let i = 0; i < times; i++) {
			this.inputEl.dispatchEvent(
				new this.inputWin.KeyboardEvent("keydown", {
					key,
					code: key,
					bubbles: true,
					cancelable: true,
				}),
			);
		}
		this.synthetic = false;
	}

	// ---------------------------------------------------------- suggestions

	async getSuggestions(query: string): Promise<OmniRow[]> {
		const token = ++this.queryToken;
		this.stack = setPageQuery(this.stack, query);

		// A pushed level answers for itself: the sources have nothing to say
		// about "which folder" or "which colour", and asking them anyway is how
		// a picker ends up listing the vault.
		const page = this.pages[this.pages.length - 1];
		if (page !== undefined) return this.buildPage(page, query);

		const parsed = parseQuery(query);
		const bar = this.options.context?.() ?? EMPTY_CONTEXT;
		this.modalEl.toggleClass("is-empty-query", isEmptyQuery(parsed));
		this.scopeLabel = SCOPE_LABELS[parsed.scope];
		this.updateStatus();

		const ctx: SourceContext = {
			app: this.app,
			bar,
			query: parsed,
			limit: this.options.sourceLimit ?? DEFAULT_SOURCE_LIMIT,
			index: this.options.index?.() ?? null,
			settings: this.options.settings?.(),
		};

		// A keystroke invalidates the request in flight: a late result
		// overwriting a newer one is the classic incremental-search bug.
		this.inflight?.abort();
		const controller = new AbortController();
		this.inflight = controller;

		const candidates: Candidate[] = [];
		const pending: Array<Promise<Candidate[]>> = [];
		for (const source of this.options.sources) {
			if (!source.appliesTo(ctx)) continue;
			if (isStreaming(source)) {
				pending.push(
					source.getCandidates(ctx, controller.signal).catch((error: unknown) => {
						console.error(`Barosaurus: source "${source.id}" failed`, error);
						return [];
					}),
				);
			} else {
				// One throwing source must not take the whole query with it.
				// getSuggestions is async, so an escaping throw becomes an
				// unhandled rejection: the list silently stops updating with no
				// notice and no degraded mode.
				try {
					candidates.push(...source.getCandidates(ctx));
				} catch (error) {
					console.error(`Barosaurus: source "${source.id}" failed`, error);
				}
			}
		}

		// Deduplicate BEFORE ranking and grouping: a "found in text" row for a
		// file the title source already returned would otherwise spend a slot
		// in its group's budget on a row that is then dropped.
		if (pending.length === 0) {
			return this.finish(this.build(dedupeFullText(candidates), parsed, bar));
		}

		this.setBusy(true);
		const streamed = await Promise.all(pending);
		this.setBusy(false);
		// A newer keystroke owns the list now; keep what is on screen rather
		// than repainting it with an answer to a question nobody asked.
		if (token !== this.queryToken) return this.rows;
		for (const batch of streamed) candidates.push(...batch);
		return this.finish(this.build(dedupeFullText(candidates), parsed, bar));
	}

	/**
	 * Rows for a pushed level. No sources, no ranking, no create row and no
	 * group overlines — a picker is one flat list, and the page has already put
	 * it in the order it wants.
	 */
	private buildPage(page: BarPage, query: string): OmniRow[] {
		this.matches = new Map();
		this.matcher = query.length > 0 ? prepareFuzzySearch(query) : null;
		this.emptyStateText = page.emptyText;
		this.modalEl.removeClass("is-empty-query");
		this.scopeLabel = "";
		this.setBusy(false);
		return this.finish(groupRows(page.rows(query), { headers: false }));
	}

	/** Rank, fold in the create row, group, interleave the overlines. */
	private build(candidates: Candidate[], parsed: ParsedQuery, bar: BarContext): GroupedRows {
		this.matches = new Map();
		for (const candidate of candidates) {
			const match = suppliedMatch(candidate);
			if (match !== null) this.matches.set(candidate.item.id, match);
		}
		// Only a fallback: a source that knows where it matched should say so.
		this.matcher = parsed.text.length > 0 ? prepareFuzzySearch(parsed.text) : null;

		// "Hide from this bar" has to bite before ranking, or a hidden command
		// still eats a slot in its group's cap and pushes a live row out.
		const hidden = this.options.actions?.hidden() ?? new Set<string>();
		const visible = withoutHidden(candidates, hidden);

		const base = this.options.rankOptions?.() ?? {};
		const boosts = this.options.contextBoostFor?.(
			visible.map((candidate) => candidate.item),
			bar,
		);
		const ranked = rankCandidates(
			visible,
			parsed.text,
			bar,
			boosts === undefined ? base : { ...base, contextBoost: boosts },
		);
		const items = ranked.map((entry) => entry.item);
		const created = this.options.createItem?.(parsed) ?? null;
		if (created !== null) items.push(created);
		return groupRows(items, this.options.grouping);
	}

	private finish(grouped: GroupedRows): OmniRow[] {
		this.rows = grouped.rows;
		this.items = grouped.items;
		this.ordinals.clear();
		grouped.items.forEach((item, index) => this.ordinals.set(item.id, index));
		this.headerNudges = 0;
		// EVERY row occupies a slot — group labels, the create row, ghosts. Set
		// the limit to the total or SuggestModal slices whole groups away.
		this.limit = grouped.limit;
		return grouped.rows;
	}

	/** Singular. `onNoSuggestions` would compile as a new property and never fire. */
	onNoSuggestion(): void {
		// A pushed level says what its own emptiness means — "Type a tag." is a
		// prompt, "No matches." would be a shrug.
		const page = this.pages[this.pages.length - 1];
		this.emptyStateText =
			page !== undefined
				? page.emptyText
				: this.scopeLabel.length > 0
					? "Nothing here."
					: "No matches.";
		super.onNoSuggestion();
	}

	// ------------------------------------------------------------ rendering

	renderSuggestion(row: OmniRow, el: HTMLElement): void {
		if (isGroupHeader(row)) {
			renderRow(row, el);
			return;
		}
		renderRow(row, el, {
			match: this.matches.get(row.id) ?? this.matcher?.(row.title) ?? null,
			ordinal: this.ordinals.get(row.id),
			resourcePath: (path) => {
				const file = this.app.vault.getFileByPath(path);
				return file === null ? null : this.app.vault.getResourcePath(file);
			},
		});
	}

	onChooseSuggestion(row: OmniRow, evt: MouseEvent | KeyboardEvent): void {
		if (isGroupHeader(row)) return; // a label is not a target

		// On a pushed level the choice belongs to that level: it commits a
		// value and the flow decides what comes next. The root's onChoose must
		// never see it, or picking a folder would try to open it.
		const page = this.pages[this.pages.length - 1];
		if (page !== undefined) {
			page.choose(row, this.surface);
			return;
		}

		// Only a query that led somewhere is worth recalling.
		this.options.actions?.rememberQuery(this.inputEl.value);
		this.historyIndex = -1;
		// Straight through: isModEvent returns PaneType | boolean, and that is
		// exactly what getLeaf()/openLinkText() accept. Narrowing it to "tab"
		// is how ⌘⌥↵ quietly stops splitting.
		this.options.onChoose?.(row, evt, Keymap.isModEvent(evt));
	}

	// ------------------------------------------------------------- actions

	/** ⌘K. Does nothing on a group label, on an empty list, or inside a flow. */
	private openActionPanel(): void {
		const actions = this.options.actions;
		if (actions === undefined || !isRoot(this.stack)) return;
		const item = this.activeItem();
		if (item === null) return;
		this.options.actions?.rememberQuery(this.inputEl.value);
		actions.openPanel(this.surface, item, this.options.context?.() ?? EMPTY_CONTEXT);
	}

	/**
	 * Run one named action on the highlighted row — Tab and ⌘P.
	 *
	 * "Applies" is the registry's own answer, so Tab on a command row and ⌘P
	 * on nothing both end here doing nothing at all. `onAction` stays the
	 * escape hatch for a host that wired no controller.
	 */
	private runOnActive(actionId: string, evt?: KeyboardEvent): void {
		if (!isRoot(this.stack)) return;
		const item = this.activeItem();
		if (item === null) return;
		const actions = this.options.actions;
		if (actions === undefined) {
			if (evt !== undefined) this.options.onAction?.(actionId, item, evt);
			return;
		}
		actions.runIfApplicable(
			this.surface,
			actionId,
			item,
			this.options.context?.() ?? EMPTY_CONTEXT,
		);
	}

	// ------------------------------------------------------------ selection

	private syncSelection(): void {
		this.pill.mount(this.resultContainerEl);
		const rows = this.rowEls();
		const index = rows.findIndex((el) => el.hasClass("is-selected"));
		if (index < 0) return;
		this.selectedIndex = index;
		const el = rows[index];
		if (el === undefined) return;

		if (isHeaderEl(el)) {
			// The default navigation landed on a label (it also does this for
			// the very first row of every result set). Step past it.
			if (this.headerNudges >= HEADER_NUDGE_BUDGET) return;
			this.headerNudges += 1;
			this.step(this.lastDirection, 1);
			return;
		}
		this.headerNudges = 0;
		this.showPreviewFor();

		// Keep the group's label on screen with its first row. Not
		// scrollIntoViewIfNeeded — that is in neither the typings nor lib.dom.
		const previous = el.previousElementSibling;
		const target =
			previous !== null && previous.classList.contains("barosaurus-group-row") ? previous : el;
		target.scrollIntoView({ block: "nearest" });
	}

	/** Render the highlighted row in the pane, if there is one. */
	private showPreviewFor(): void {
		if (this.preview === null) return;
		const item = this.activeItem();
		if (item === null) {
			this.preview.clear();
			return;
		}
		void this.preview.show(item, foldedWords(this.inputEl.value));
	}

	private rowEls(): HTMLElement[] {
		return Array.from(this.resultContainerEl.querySelectorAll<HTMLElement>(".suggestion-item"));
	}

	/** The highlighted item, or null when the selection is on a label. */
	activeItem(): OmniItem | null {
		const row = this.rows[this.selectedIndex] ?? this.rows.find((entry) => !isGroupHeader(entry));
		if (row === undefined || isGroupHeader(row)) return null;
		return row;
	}

	// ----------------------------------------------------------- page stack

	/**
	 * What a page may do to the bar. Handed to every page and to the flow, so
	 * neither has to know this class exists.
	 */
	private readonly surface: BarSurface = {
		pushPage: (page, initialQuery) => this.pushPage(page, initialQuery),
		popPage: () => this.popPage(),
		commit: (value) => {
			this.stack = setPageValue(this.stack, value);
			this.renderBreadcrumbs();
		},
		collected: () => collectedValues(this.stack),
		refresh: () => this.refresh(),
		close: () => this.close(),
	};

	/** Push a picker level: "Move to…" and friends collect one value each. */
	pushPage(page: BarPage, initialQuery = ""): void {
		// Only the two state fields go into the stack — it is a record of where
		// you are, not a place to park callbacks.
		this.stack = push(this.stack, { kind: page.kind, label: page.label });
		this.pages.push(page);
		this.historyIndex = -1;
		this.applyLevel();
		this.setQuery(initialQuery);
	}

	/** Pop one level, restoring the query typed there. False at the root. */
	popPage(): boolean {
		const next = pop(this.stack);
		if (next === this.stack) return false;
		this.stack = next;
		this.pages.pop();
		this.historyIndex = -1;
		this.applyLevel();
		this.setQuery(current(this.stack).query);
		return true;
	}

	/** Placeholder, instructions and breadcrumbs for whatever level is on top. */
	private applyLevel(): void {
		const page = this.pages[this.pages.length - 1];
		this.setPlaceholder(
			page?.placeholder ?? this.options.placeholder ?? "Search, jump or do something…",
		);
		this.setInstructions(
			page === undefined ? (this.options.instructions ?? DEFAULT_INSTRUCTIONS) : PAGE_INSTRUCTIONS,
		);
		this.modalEl.toggleClass("is-nested", page !== undefined);
		this.renderBreadcrumbs();
	}

	/** Where the bar currently is. Read-only for the action layer. */
	pageState(): PageStackState {
		return this.stack;
	}

	private renderBreadcrumbs(): void {
		this.breadcrumbEl.empty();
		const crumbs = breadcrumbs(this.stack);
		this.breadcrumbEl.toggleClass("is-empty", crumbs.length === 0);
		for (const page of crumbs) {
			const crumb = this.breadcrumbEl.createDiv({ cls: "barosaurus-crumb" });
			crumb.createSpan({ cls: "barosaurus-crumb-label", text: page.label });
			if (page.value !== undefined && page.value.length > 0) {
				crumb.createSpan({ cls: "barosaurus-crumb-value", text: page.value });
			}
		}
	}

	// --------------------------------------------------------------- status

	private setBusy(busy: boolean): void {
		this.busy = busy;
		this.updateStatus();
	}

	private updateStatus(): void {
		const text = this.busy ? "Searching…" : this.scopeLabel;
		this.statusEl.setText(text);
		this.statusEl.toggleClass("is-visible", text.length > 0);
	}

	// -------------------------------------------------------------- helpers

	/** Set the input and re-run the query. */
	setQuery(value: string): void {
		this.inputEl.value = value;
		this.refresh();
	}

	/**
	 * Re-run getSuggestions. `updateSuggestions()` is not in the typings, so it
	 * goes through the quarantine in unsafe.ts, which returns false instead of
	 * throwing when the internal is gone — and then the public input event does
	 * the same job.
	 */
	refresh(): void {
		if (forceUpdateSuggestions(this)) return;
		this.inputEl.dispatchEvent(new this.inputWin.Event("input"));
	}
}

function isHeaderEl(el: HTMLElement): boolean {
	return el.hasClass("barosaurus-group-row");
}

function wrapIndex(index: number, length: number): number {
	if (length === 0) return 0;
	return ((index % length) + length) % length;
}

/**
 * The SearchResult a source matched with, if it attached one.
 *
 * `Candidate` has no slot for it yet, so it is read structurally rather than
 * re-derived: only the source knows whether it matched the title, an alias or
 * the body. The cast is to a documented obsidian interface, never to `any`,
 * and disappears the day Candidate grows a `match` field.
 */
function suppliedMatch(candidate: Candidate): SearchResult | null {
	const carrier = candidate as Candidate & Partial<SearchResultContainer>;
	return carrier.match ?? null;
}
