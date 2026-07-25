import type { App } from "obsidian";
import { EMPTY_CONTEXT, type GroupId, type OmniItem } from "../src/core/types";
import { parseQuery } from "../src/core/query";
import { candidatesFromOrdered, type Source, type SourceContext } from "../src/sources/source";

/**
 * Fixtures for the UI pipeline. The real sources do not exist yet — the modal
 * takes them by injection precisely so grouping, empty-group removal and the
 * limit arithmetic can be proven against these instead.
 *
 * Nothing here imports obsidian at runtime: `App` is a type-only import, so
 * the whole file is loadable under plain vitest with no shim.
 */

export function fixtureCommand(id: string, title = id): OmniItem {
	return {
		kind: "command",
		source: "command",
		group: "commands",
		commandId: id,
		id,
		title,
		aliases: [],
		tile: { kind: "icon", icon: "terminal" },
	};
}

export function fixtureFile(id: string, title = id, group: GroupId = "files"): OmniItem {
	return {
		kind: "file",
		source: "file",
		group,
		id,
		title,
		aliases: [],
		path: `notes/${id}.md`,
		resultKind: "note",
		mtime: 0,
		tile: { kind: "icon", icon: "file-text" },
	};
}

export function fixtureTag(id: string, count = 1): OmniItem {
	return {
		kind: "tag",
		source: "tag",
		group: "tags",
		id,
		title: `#${id}`,
		aliases: [],
		tag: id,
		count,
		tile: { kind: "icon", icon: "hash" },
	};
}

export function fixtureCreate(query: string): OmniItem {
	return {
		kind: "create",
		source: "create",
		group: "create",
		id: `create:${query}`,
		title: query,
		aliases: [],
		query,
		tile: { kind: "icon", icon: "plus" },
	};
}

/**
 * Deliberately NOT in GROUP_ORDER order, and deliberately missing several
 * groups — proving that grouping re-orders and that absent groups leave no
 * label behind is the whole point of the fixture.
 */
export const FIXTURE_ITEMS: readonly OmniItem[] = [
	fixtureTag("project"),
	fixtureFile("alpha"),
	fixtureCommand("editor:toggle-bold", "Toggle bold"),
	fixtureFile("beta"),
	fixtureCommand("app:go-back", "Go back"),
	fixtureTag("design"),
];

/** A Source over a fixed item list, normalized by position like a real one. */
export function fixtureSource(
	id: string,
	items: readonly OmniItem[],
	applies: (ctx: SourceContext) => boolean = () => true,
): Source {
	return {
		id,
		appliesTo: applies,
		getCandidates: (ctx) => candidatesFromOrdered(items.slice(0, ctx.limit)),
	};
}

/** A SourceContext with no App behind it — nothing pure ever dereferences it. */
export function fixtureContext(query: string, limit = 20): SourceContext {
	return {
		app: undefined as unknown as App,
		bar: EMPTY_CONTEXT,
		query: parseQuery(query),
		limit,
	};
}
