import { Platform, type App, type Command } from "obsidian";
import { filterAvailable, type PluginCapabilities } from "../core/availability";
import { CURATED_BY_ID, FAMILY_COMMANDS, type CuratedCommand } from "../core/catalog";
import { fold } from "../core/normalize";
import type { Candidate, GroupId, OmniItem, TileSpec } from "../core/types";
import {
	getEnabledPluginIds,
	getHotkeyChip,
	getPinnedCommandIds,
	isCorePluginEnabled,
	listCommands,
} from "../ui/unsafe";
import { fuzzyFactory, orderByMatch, type Scorable } from "./files";
import { candidatesFromOrdered, type Source, type SourceContext } from "./source";

/**
 * Every registered command, curated and gated — the heart of the bar.
 *
 * Three layers stack here, and the order matters:
 *
 *  1. ENUMERATION. `listCommands()` returns everything, including the commands
 *     of plugins we have never heard of. Nothing is dropped for being unknown.
 *  2. CURATION. `CURATED_BY_ID` overlays a better name, an icon, DE/EN aliases
 *     and context tags on the entries people actually reach for. The command
 *     still executes by its real id — we rename the door, not the room.
 *  3. AVAILABILITY. A command that cannot run right now is HIDDEN, not shown
 *     and broken. That is the whole point of `checkCallback(true)`: "checking"
 *     means "would you run?", and a false answer is Obsidian's own contract for
 *     "do not offer me". Shipping a palette that ignores it is how you get rows
 *     that do nothing when clicked.
 */

const FAMILY_IDS: ReadonlySet<string> = new Set(FAMILY_COMMANDS.map((entry) => entry.commandId));

/** Overscan: the availability oracle runs after matching, never over the whole list. */
function overscanFor(limit: number): number {
	return limit * 4 + 20;
}

// ------------------------------------------------------------- availability

interface Runnability {
	runnable: boolean;
	/** A command that takes an editor IS an editor command — tag it as one. */
	editorCommand: boolean;
}

/**
 * The availability oracle.
 *
 * `checkCallback(true)` and `editorCheckCallback(true, …)` are the documented
 * "are you available?" calls; `checking: true` guarantees the command performs
 * no action. Third-party callbacks can still throw, and a throwing callback is
 * a broken command — GUESS: we hide it, on the grounds that a row that throws
 * on sight will not run any better when clicked.
 */
export function runnability(app: App, command: Command): Runnability {
	const editorCommand =
		command.editorCheckCallback !== undefined || command.editorCallback !== undefined;
	const info = app.workspace.activeEditor;
	const editor = info?.editor;

	try {
		if (command.editorCheckCallback !== undefined) {
			if (info === null || editor === undefined) return { runnable: false, editorCommand };
			const answer: unknown = command.editorCheckCallback(true, editor, info);
			// Truthiness, not `=== true`: that is the gate Obsidian's own palette
			// applies, and plugins do return truthy non-booleans.
			return { runnable: Boolean(answer), editorCommand };
		}
		if (command.editorCallback !== undefined) {
			return { runnable: info !== null && editor !== undefined, editorCommand };
		}
		if (command.checkCallback !== undefined) {
			const answer: unknown = command.checkCallback(true);
			return { runnable: Boolean(answer), editorCommand };
		}
	} catch (error) {
		console.error(`[barosaurus] command "${command.id}" threw while checking availability`, error);
		return { runnable: false, editorCommand };
	}

	return { runnable: true, editorCommand };
}

// ----------------------------------------------------------------- corpus

interface CommandEntry {
	command: Command;
	curated: CuratedCommand | undefined;
	group: GroupId;
	pinned: boolean;
	terms: string[];
}

/** Folded terms per command, invalidated when the command's name changes. */
const termCache = new Map<string, { name: string; terms: string[] }>();

/**
 * "Templater: Insert template" → plugin "Templater", label "Insert template".
 * Core commands carry no prefix and keep their name as-is.
 */
export function splitCommandName(name: string): { plugin: string | undefined; label: string } {
	const cut = name.indexOf(": ");
	if (cut <= 0) return { plugin: undefined, label: name };
	return { plugin: name.slice(0, cut), label: name.slice(cut + 2) };
}

function termsFor(command: Command, curated: CuratedCommand | undefined): string[] {
	const cached = termCache.get(command.id);
	if (cached !== undefined && cached.name === command.name) return cached.terms;
	const { label } = splitCommandName(command.name);
	const terms = [command.name, label, ...(curated ? [curated.name, ...curated.aliases] : [])]
		.map(fold)
		.filter((term, index, all) => term.length > 0 && all.indexOf(term) === index);
	termCache.set(command.id, { name: command.name, terms });
	return terms;
}

function unique(values: readonly string[], exclude: string): string[] {
	const out: string[] = [];
	const seen = new Set([fold(exclude)]);
	for (const value of values) {
		const key = fold(value);
		if (key.length === 0 || seen.has(key)) continue;
		seen.add(key);
		out.push(value);
	}
	return out;
}

function tileFor(curated: CuratedCommand | undefined, command: Command): TileSpec {
	if (curated?.tile !== undefined) return curated.tile;
	return { kind: "icon", icon: curated?.icon ?? command.icon ?? "chevron-right" };
}

function itemFor(app: App, entry: CommandEntry, editorCommand: boolean): OmniItem {
	const { command, curated, group } = entry;
	const { plugin, label } = splitCommandName(command.name);
	const title = curated?.name ?? label;
	const tags = new Set<string>(curated?.contextTags ?? []);
	if (editorCommand) tags.add("editor");
	const hotkey = getHotkeyChip(app, command.id);

	return {
		id: `command:${command.id}`,
		kind: "command",
		source: "command",
		group,
		title,
		aliases: unique([...(curated?.aliases ?? []), command.name, label], title),
		subtitle: plugin,
		tile: tileFor(curated, command),
		hotkey: hotkey ?? undefined,
		contextTags: [...tags],
		commandId: command.id,
	};
}

/**
 * The plugin gates, wired from the quarantine. Everything gated
 * (`requiresPlugin` / `requiresCorePlugin`) goes through this, so a missing
 * internal degrades to "gated things are hidden" rather than to a broken row.
 */
export function pluginCapabilities(app: App): PluginCapabilities {
	const enabled = getEnabledPluginIds(app);
	return {
		isPluginEnabled: (id) => enabled.has(id),
		isCorePluginEnabled: (id) => isCorePluginEnabled(app, id),
	};
}

/**
 * Enumerated commands plus the gated family entries, pre-sorted into the order
 * the empty state wants: pinned, then curated, then everything else by name.
 */
function corpus(app: App): CommandEntry[] {
	const registered = listCommands(app);
	const byId = new Map(registered.map((command) => [command.id, command]));
	const pinned = getPinnedCommandIds(app);
	const pinnedRank = new Map(pinned.map((id, index) => [id, index]));

	const entries: CommandEntry[] = [];
	for (const command of registered) {
		if (FAMILY_IDS.has(command.id)) continue; // shown once, in the family group
		if (command.mobileOnly === true && !Platform.isMobile) continue;
		const curated = CURATED_BY_ID.get(command.id);
		entries.push({
			command,
			curated,
			group: "commands",
			pinned: pinnedRank.has(command.id),
			terms: termsFor(command, curated),
		});
	}

	// The family group is gated twice: the plugin must be enabled AND the
	// command must really be registered. A group with nothing left contributes
	// no items, so its overline label never renders.
	for (const family of filterAvailable(FAMILY_COMMANDS, pluginCapabilities(app))) {
		const command = byId.get(family.commandId);
		if (command === undefined) continue;
		entries.push({
			command,
			curated: family,
			group: "family",
			pinned: pinnedRank.has(command.id),
			terms: termsFor(command, family),
		});
	}

	entries.sort((a, b) => {
		const pinA = pinnedRank.get(a.command.id) ?? Number.MAX_SAFE_INTEGER;
		const pinB = pinnedRank.get(b.command.id) ?? Number.MAX_SAFE_INTEGER;
		if (pinA !== pinB) return pinA - pinB;
		const curatedA = a.curated === undefined ? 1 : 0;
		const curatedB = b.curated === undefined ? 1 : 0;
		if (curatedA !== curatedB) return curatedA - curatedB;
		return a.command.name.localeCompare(b.command.name);
	});
	return entries;
}

// ----------------------------------------------------------------- source

export const commandsSource: Source = {
	id: "command",

	/**
	 * ">" means commands and nothing else, which is why this is the one source
	 * that answers that scope. Under "all" it steps aside for the vault
	 * operators — a kind letter, a path prefix, a recency window or a #tag are
	 * all statements about files, and a command can satisfy none of them.
	 */
	appliesTo(ctx: SourceContext): boolean {
		if (ctx.query.scope === "command") return true;
		if (ctx.query.scope !== "all") return false;
		return (
			ctx.query.kind === null &&
			ctx.query.pathPrefix === null &&
			ctx.query.modifiedWithinDays === null &&
			ctx.query.tags.length === 0
		);
	},

	getCandidates(ctx: SourceContext): Candidate[] {
		const { app, query, limit } = ctx;
		if (limit <= 0) return [];

		const entries: Array<Scorable<CommandEntry>> = corpus(app).map((entry) => ({
			value: entry,
			terms: entry.terms,
		}));

		const foldedQuery = fold(query.text);
		const matched = orderByMatch(entries, foldedQuery, fuzzyFactory, overscanFor(limit));

		// The oracle runs on matches only — a vault with a thousand commands
		// would otherwise pay for every check callback on every keystroke.
		// Pinned commands lead, stably: each keeps its relative match order, and
		// leading this source's own list never overrides a tier, because the
		// ranker compares tiers first and norms only within one.
		const lead: OmniItem[] = [];
		const rest: OmniItem[] = [];
		for (const entry of matched) {
			const { runnable, editorCommand } = runnability(app, entry.command);
			if (!runnable) continue;
			(entry.pinned ? lead : rest).push(itemFor(app, entry, editorCommand));
			if (lead.length + rest.length >= limit * 2) break;
		}

		return candidatesFromOrdered([...lead, ...rest].slice(0, limit));
	},
};
