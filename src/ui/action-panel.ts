import type { App } from "obsidian";
import {
	ACTIONS,
	argumentCount,
	closesBar,
	historyQuery,
	historyStep,
	isPinned,
	nextArgument,
} from "../core/actions";
import { actionsFor, NONE_AVAILABLE, type PluginCapabilities } from "../core/availability";
import { pushHistory } from "../core/history";
import { fold } from "../core/normalize";
import { fileItemId, type ActionDef, type BarContext, type OmniItem } from "../core/types";
import { fuzzyFactory, orderByMatch, type Scorable } from "../sources/files";
import { pluginCapabilities } from "../sources/commands";
import { runAction, type ExecuteHost } from "./execute";
import { commandPage, pageFor, type BarPage, type BarSurface } from "./picker";

/**
 * The ⌘K action panel and the flows behind it.
 *
 * ## The design decision: a pushed page, not a second Modal
 *
 * The panel is a level of the bar itself. A separate Modal was the obvious
 * alternative and is the wrong one here:
 *
 *  - It would take focus off the bar and then have to give it back, and
 *    Obsidian's modal stack means the bar underneath keeps its own Esc — two
 *    surfaces racing for one key.
 *  - It would need its own list, matcher, selection pill, ⌘1–9 layer and row
 *    renderer: a second copy of everything the user already has on screen.
 *  - The arguments AFTER the panel (a folder, a colour) have to be collected
 *    somewhere anyway, and `src/core/pagestack.ts` is already the state machine
 *    for that, with per-level queries and breadcrumbs. Making the panel the
 *    first pushed level means panel and pickers are one mechanism, and
 *    `collectedValues()` produces the argument list with nothing added.
 *  - "Esc goes back one level, only the root closes" then reads the same
 *    whether you are one level deep or three.
 *
 * The single exception is the delete confirmation, which really is modal: it
 * must not be dismissible by the same Esc that means "back", and it lives in
 * src/ui/execute.ts as its own tiny Modal.
 */

// -------------------------------------------------------------------- host

/**
 * Everything the panel needs from the plugin. Same object the executor takes,
 * so `src/main.ts` builds one host and passes it to both.
 */
export type ActionHost = ExecuteHost;

/** What the modal calls. Built by `createActionController`. */
export interface ActionController {
	/** Applicable actions for an item, in registry order. First is primary. */
	actionsFor(item: OmniItem, ctx: BarContext): ActionDef[];
	/** ⌘K — push the panel for the highlighted item. */
	openPanel(bar: BarSurface, item: OmniItem, ctx: BarContext): void;
	/** Run one action by id, collecting arguments first if it declares any. */
	run(bar: BarSurface, action: ActionDef, item: OmniItem): void;
	/** Tab and ⌘P: run an action only if it applies. False when it does not. */
	runIfApplicable(bar: BarSurface, actionId: string, item: OmniItem, ctx: BarContext): boolean;
	/**
	 * Start an argument flow against a path rather than a highlighted result —
	 * how a row in the MAIN list (not the ⌘K panel) reaches a multi-step action.
	 * `prefilled` supplies the first argument when the row already named it.
	 */
	startOnPath(bar: BarSurface, actionId: string, path: string, prefilled?: string): boolean;
	/** Command ids the user hid from the bar. */
	hidden(): ReadonlySet<string>;
	/** Recent queries, newest first. */
	history(): readonly string[];
	/** Remember a query that led somewhere. */
	rememberQuery(query: string): void;
	/** Where ↑ / ↓ land next. `-1` is the live input. */
	historyStep(index: number, direction: 1 | -1): number;
	/** The text an index stands for. */
	historyQuery(index: number): string;
}

// ------------------------------------------------------------------- rows

/**
 * A panel row. Same `kind: "action"` shape the pickers use, so the renderer,
 * the highlighting and ⌘1–9 all work with no special case; `hotkey` is the
 * shortcut chip the renderer already draws on the right.
 */
function actionRow(action: ActionDef, item: OmniItem, host: ActionHost): OmniItem {
	const row: OmniItem = {
		id: `action:${action.id}`,
		kind: "action",
		source: "command",
		group: "actions",
		title: labelFor(action, item, host),
		aliases: action.aliases,
		tile: { kind: "icon", icon: action.icon },
		actionId: action.id,
	};
	return action.shortcut === undefined ? row : { ...row, hotkey: action.shortcut };
}

/**
 * The one label that is not static: a pinned row offers to unpin. Keeping that
 * out of the registry keeps `appliesTo` pure and the registry stateless.
 */
function labelFor(action: ActionDef, item: OmniItem, host: ActionHost): string {
	if (action.id !== "pin") return action.name;
	const pins = host.pins?.() ?? [];
	return isPinned(pins, item.id) ? "Unpin" : "Pin";
}

// ----------------------------------------------------------------- panel

/**
 * The panel page. The item it acts on is captured here, so every level pushed
 * on top of it collects for THIS item however deep the flow goes.
 */
function panelPage(
	item: OmniItem,
	ctx: BarContext,
	host: ActionHost,
	caps: PluginCapabilities,
	run: (bar: BarSurface, action: ActionDef, item: OmniItem) => void,
): BarPage {
	const applicable = actionsFor(ACTIONS, item, ctx, caps);
	const byId = new Map(applicable.map((action) => [action.id, action]));

	return {
		kind: "actions",
		// The breadcrumb says what you are acting on, not "Actions" — the pill
		// is the only thing on screen still naming the item once the list below
		// has been replaced by folders or colours.
		label: item.title,
		placeholder: "Search actions…",
		emptyText: "Nothing to do here.",
		rows: (query) => {
			const entries: Array<Scorable<OmniItem>> = applicable.map((action) => ({
				value: actionRow(action, item, host),
				terms: [action.name, ...action.aliases].map(fold).filter((term) => term.length > 0),
			}));
			return orderByMatch(entries, fold(query), fuzzyFactory, entries.length);
		},
		choose: (row, bar) => {
			if (row.kind !== "action") return;
			const action = byId.get(row.actionId);
			if (action === undefined) return;
			run(bar, action, item);
		},
	};
}

// ------------------------------------------------------------------ flow

/**
 * Argument pages that override what the registry declares.
 *
 * `ArgumentPicker` has no "command" kind and lives in core/types.ts, so
 * "Run any command on this…" declares its argument as free text. Offering the
 * real command list instead is strictly better and changes nothing about the
 * flow — a page is a page, and the value it commits is still one string.
 */
const PAGE_OVERRIDES: Readonly<Record<string, (prompt: string, app: App) => BarPage>> = {
	"run-command-on": commandPage,
};

export function createActionController(host: ActionHost): ActionController {
	const { app } = host;

	// Probed per open rather than cached: a plugin enabled while the bar was
	// never closed would otherwise keep its actions hidden forever. Falls back
	// to "nothing gated is available", which hides gated rows instead of
	// offering ones that cannot work.
	const caps = (): PluginCapabilities => {
		try {
			return pluginCapabilities(app);
		} catch (error) {
			console.error("Barosaurus: could not read the plugin registry", error);
			return NONE_AVAILABLE;
		}
	};

	/** Push the next argument page, or run the action when there are none left. */
	const advance = (bar: BarSurface, action: ActionDef, item: OmniItem): void => {
		const collected = bar.collected();
		const picker = nextArgument(action, collected.length);
		if (picker === null) {
			void finish(bar, action, item, collected);
			return;
		}
		const override = PAGE_OVERRIDES[action.id];
		const page = override === undefined ? pageFor(picker, app) : override(picker.prompt, app);
		// Every picker level reports back here, so a three-argument action needs
		// no state beyond the page stack it is already pushing onto.
		bar.pushPage(
			{
				...page,
				choose: (row, surface) => {
					page.choose(row, surface);
					advance(surface, action, item);
				},
			},
			initialQueryFor(action, item, collected.length),
		);
	};

	const finish = async (
		bar: BarSurface,
		action: ActionDef,
		item: OmniItem,
		args: readonly string[],
	): Promise<void> => {
		const outcome = await runAction(host, action.id, item, args);
		if (outcome === "close" && closesBar(action.id)) {
			bar.close();
			return;
		}
		// Staying means the panel would still be sitting on a stale label
		// ("Pin" after pinning), so unwind to the root and repaint.
		while (bar.popPage()) {
			/* unwind every level this flow pushed */
		}
		bar.refresh();
	};

	return {
		actionsFor: (item, ctx) => actionsFor(ACTIONS, item, ctx, caps()),

		openPanel: (bar, item, ctx) => {
			bar.pushPage(panelPage(item, ctx, host, caps(), advance));
		},

		run: (bar, action, item) => advance(bar, action, item),

		runIfApplicable: (bar, actionId, item, ctx) => {
			const action = actionsFor(ACTIONS, item, ctx, caps()).find(
				(entry) => entry.id === actionId,
			);
			if (action === undefined) return false;
			advance(bar, action, item);
			return true;
		},

		startOnPath: (bar, actionId, path, prefilled) => {
			const action = ACTIONS.find((entry) => entry.id === actionId);
			if (action === undefined) return false;
			// A row in the main list has no path of its own, so the flow is given
			// a file item built from the path the row carried. Without this the
			// root-level choose path would call runAction with an empty argument
			// list and the action would silently do nothing — the same shape of
			// bug that made every action look dead before 0.9.6.
			//
			// The real file is looked up rather than assumed: a stale path means
			// the note was renamed or deleted while the bar was open, and the
			// honest answer is to decline instead of writing to a guess.
			const file = app.vault.getFileByPath(path);
			if (file === null) return false;
			const item: OmniItem = {
				id: fileItemId(path),
				kind: "file",
				source: "file",
				group: "files",
				title: file.basename,
				aliases: [],
				tile: { kind: "icon", icon: "file-text" },
				path,
				resultKind: file.extension === "md" ? "note" : "file",
				mtime: file.stat.mtime,
			};
			if (prefilled === undefined) {
				advance(bar, action, item);
				return true;
			}
			// The row already named the property, so that page is skipped: push a
			// level that carries the value and let `advance` ask for the rest.
			bar.pushPage(
				{
					kind: "prefilled",
					label: prefilled,
					placeholder: "",
					emptyText: "",
					rows: () => [],
					choose: () => undefined,
				},
				"",
			);
			bar.commit(prefilled);
			advance(bar, action, item);
			return true;
		},

		hidden: () => new Set(host.hiddenCommands?.() ?? []),
		history: () => host.history?.() ?? [],
		// pushHistory owns the trimming, the dedupe and the bound, so an empty
		// query is a no-op and the same query twice does not grow the list.
		rememberQuery: (query) => {
			const write = host.setHistory;
			if (write === undefined) return;
			write(pushHistory(host.history?.() ?? [], query));
		},
		historyStep: (index, direction) =>
			historyStep((host.history?.() ?? []).length, index, direction),
		historyQuery: (index) => historyQuery(host.history?.() ?? [], index),
	};
}

/**
 * What the input starts with on a picker level. Rename prefills the current
 * name so the common case — change two letters — is two keystrokes rather than
 * retyping the whole thing. Only ever the FIRST argument: a prefill on a later
 * level would be answering a question the user has not been asked yet.
 */
function initialQueryFor(action: ActionDef, item: OmniItem, index: number): string {
	if (index !== 0 || argumentCount(action) === 0) return "";
	return action.id === "rename" ? item.title : "";
}
