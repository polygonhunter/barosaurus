/**
 * The shared vocabulary of the bar. Every source produces OmniItems, the
 * ranker orders Candidates wrapping them, the renderer switches on the kind.
 *
 * Two rules keep this file load-bearing rather than decorative:
 *  - `OmniItem` is a DISCRIMINATED union on `kind`, so the renderer and the
 *    action registry are exhaustive switches the compiler checks.
 *  - Nothing here imports obsidian. TFile, Editor and friends never cross
 *    into core; sources translate at the boundary.
 */

// ---------------------------------------------------------------- sources

/** Where an item came from. One source owns one SourceId. */
export type SourceId =
	| "command"
	| "file"
	| "heading"
	| "block"
	| "tab"
	| "bookmark"
	| "folder"
	| "tag"
	| "fulltext"
	| "create"
	| "ghost";

/**
 * Display grouping. Deliberately coarser than SourceId: headings and blocks
 * share a group, and a group with no items disappears together with its
 * overline label.
 */
export type GroupId =
	| "actions"
	| "commands"
	| "openTabs"
	| "files"
	| "structure"
	| "bookmarks"
	| "folders"
	| "tags"
	| "fulltext"
	| "family"
	| "create";

/** Display order of the groups. `GROUP_ORDER.indexOf(g)` IS the sort key. */
export const GROUP_ORDER: readonly GroupId[] = [
	"actions",
	"commands",
	"openTabs",
	"files",
	"structure",
	"bookmarks",
	"folders",
	"tags",
	"fulltext",
	"family",
	"create",
];

/** Sentence case, like every other label in the UI. */
export const GROUP_LABELS: Record<GroupId, string> = {
	actions: "Actions",
	commands: "Commands",
	openTabs: "Open tabs",
	files: "Notes and files",
	structure: "Headings and blocks",
	bookmarks: "Bookmarks",
	folders: "Folders",
	tags: "Tags",
	fulltext: "Found in text",
	family: "-osaurus family",
	create: "Create",
};

// ---------------------------------------------------------------- results

/** Vault result families, mirrored by the filter row. */
export type ResultKind = "note" | "file" | "image" | "link";

/**
 * Preview tile shown at the head of a row. A discriminated union so the
 * renderer is one exhaustive switch and adding a tile style never touches
 * the ranker.
 */
export type TileSpec =
	| { kind: "icon"; icon: string }
	| { kind: "callout"; calloutType: string }
	| { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6 }
	| { kind: "quote" }
	| { kind: "mono"; sample: string }
	| { kind: "list"; marker: "bullet" | "number" | "check" }
	| { kind: "table" }
	| { kind: "divider" }
	| { kind: "swatch"; color: string }
	| { kind: "thumbnail"; path: string };

/** Fields every item must offer, because ranking and rendering need them. */
interface OmniItemBase {
	/** Unique within a single result set; also the frecency key. */
	id: string;
	source: SourceId;
	group: GroupId;
	/** The string the user is matching against. */
	title: string;
	/** Extra match terms — DE and EN coexist here, folded before comparison. */
	aliases: string[];
	/** Second line: plugin name, folder path, note title… */
	subtitle?: string;
	tile: TileSpec;
	/** Rendered as a chip on the right. */
	hotkey?: string;
	/**
	 * Situation labels the context ranker reads: "formatting", "selection",
	 * "editor", "navigation", "vault". Two sources fill these — the curated
	 * catalog by hand, and the command source automatically from the
	 * availability oracle (an editorCheckCallback means "editor").
	 */
	contextTags?: readonly string[];
}

export type OmniItem =
	| (OmniItemBase & { kind: "command"; source: "command"; commandId: string })
	| (OmniItemBase & {
			kind: "file";
			source: "file" | "fulltext";
			path: string;
			resultKind: ResultKind;
			mtime: number;
			/** Line to scroll to, for a fulltext hit. */
			line?: number;
	  })
	| (OmniItemBase & {
			kind: "heading";
			source: "heading";
			path: string;
			level: number;
			line: number;
	  })
	| (OmniItemBase & { kind: "block"; source: "block"; path: string; blockId: string; line: number })
	| (OmniItemBase & { kind: "tab"; source: "tab"; leafId: string; path?: string })
	| (OmniItemBase & { kind: "bookmark"; source: "bookmark"; path?: string })
	| (OmniItemBase & { kind: "folder"; source: "folder"; path: string })
	| (OmniItemBase & { kind: "tag"; source: "tag"; tag: string; count: number })
	| (OmniItemBase & { kind: "action"; source: "command"; actionId: string })
	| (OmniItemBase & { kind: "ghost"; source: "ghost"; linktext: string })
	| (OmniItemBase & {
			kind: "create";
			source: "create";
			query: string;
			/**
			 * The exact path the row promises, already sanitised and folded
			 * into the `p:` folder. Carried on the item so the executor cannot
			 * create something other than what the subtitle showed.
			 */
			path: string;
	  });

/**
 * A synthetic, unselectable row carrying a group label. Kept OUT of OmniItem
 * so no action or ranking path can ever receive one, but it still occupies a
 * slot in the rendered list — which is why `limit` must count these too.
 */
export interface GroupHeader {
	kind: "group-header";
	group: GroupId;
	label: string;
}

/** What SuggestModal actually renders. */
export type OmniRow = OmniItem | GroupHeader;

export function isGroupHeader(row: OmniRow): row is GroupHeader {
	return row.kind === "group-header";
}

/**
 * The id a file item carries — and therefore the key its frecency and pins are
 * stored under.
 *
 * It lives here rather than inline in the files source because two very
 * distant places have to agree on it: the source that mints the item, and the
 * plugin's `file-open` handler, which records usage for files opened anywhere
 * in Obsidian, not just through the bar. When those two disagreed, frecency
 * silently learned nothing while its dead entries evicted the live ones.
 */
export function fileItemId(path: string): string {
	return `file:${path}`;
}

// ---------------------------------------------------------------- context

/** The editing situation, injected into ranking and action availability. */
export interface BarContext {
	/** Path of the active file, if any. */
	activeFile: string | null;
	/** Non-empty when the user has text selected. */
	selection: string;
	/** True when an editor has focus and can be written to. */
	hasEditor: boolean;
	/** Active view type: "markdown", "canvas", "pdf", … */
	viewType: string | null;
	/** Epoch ms, injected so ranking stays deterministic in tests. */
	now: number;
}

export const EMPTY_CONTEXT: BarContext = {
	activeFile: null,
	selection: "",
	hasEditor: false,
	viewType: null,
	now: 0,
};

// ---------------------------------------------------------------- ranking

/**
 * A source's candidate, already recalled and normalized BY THAT SOURCE.
 *
 * `norm` is the crux of mixing heterogeneous sources: MiniSearch returns
 * positive BM25, prepareFuzzySearch returns negative scores, and a tab list
 * has no score at all. Comparing those raw numbers puts every command below
 * every file regardless of match quality. So each source rank-normalizes its
 * own output to [0,1] (1 - i/n is the safe default) and the cross-source
 * comparison happens on tiers, never on native scores.
 */
export interface Candidate {
	item: OmniItem;
	/** Source-local quality in [0,1], 1 = best of that source. */
	norm: number;
}

/** Match quality tiers. Lower is better; the tier dominates absolutely. */
export const TIER_EXACT = 0;
export const TIER_PREFIX = 1;
export const TIER_CONTIGUOUS = 2;
export const TIER_ACRONYM = 3;
export const TIER_FUZZY = 4;

/**
 * How much a source is worth once tiers tie. Not a filter — a thumb on the
 * scale, so an exactly-matching tag still beats a fuzzily-matching command.
 */
export type TypeWeights = Record<SourceId, number>;

export const DEFAULT_TYPE_WEIGHTS: TypeWeights = {
	command: 1.0,
	tab: 0.95,
	file: 0.9,
	bookmark: 0.85,
	heading: 0.7,
	block: 0.6,
	folder: 0.6,
	tag: 0.6,
	fulltext: 0.45,
	ghost: 0.3,
	create: 0.1,
};

// ---------------------------------------------------------------- actions

/**
 * A picker step in a multi-stage flow. The bar pushes a page, collects one
 * value, and hands it back to the action.
 */
export type ArgumentPicker =
	| { kind: "folder"; prompt: string }
	| { kind: "tag"; prompt: string }
	| { kind: "template"; prompt: string }
	| { kind: "color"; prompt: string }
	| { kind: "align"; prompt: string }
	| { kind: "language"; prompt: string }
	| { kind: "text"; prompt: string; placeholder: string };

/**
 * An entry in the ⌘K panel for a highlighted item. `appliesTo` is pure so the
 * whole registry is unit-testable without an App.
 */
export interface ActionDef {
	id: string;
	name: string;
	aliases: string[];
	icon: string;
	/** Shown as a chip; display only, never registered as a real hotkey. */
	shortcut?: string;
	/** First applicable action is the primary one — Enter runs it. */
	appliesTo(item: OmniItem, ctx: BarContext): boolean;
	/** Pushed as pages before the action runs. */
	arguments?: ArgumentPicker[];
	/** Hidden unless this community plugin is installed and enabled. */
	requiresPlugin?: string;
	/** Hidden unless this core plugin is available (bookmarks, daily notes…). */
	requiresCorePlugin?: string;
}
