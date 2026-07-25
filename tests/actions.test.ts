import { describe, expect, it } from "vitest";
import {
	ACTIONS,
	ACTIONS_BY_ID,
	argumentCount,
	closesBar,
	historyQuery,
	historyStep,
	isHiddenItem,
	isPinned,
	nextArgument,
	togglePinned,
	toggleHidden,
	withoutHidden,
} from "../src/core/actions";
import { actionsFor, ALL_AVAILABLE, NONE_AVAILABLE } from "../src/core/availability";
import { EMPTY_CONTEXT, type BarContext, type OmniItem } from "../src/core/types";
import { fixtureCommand, fixtureFile, fixtureTag } from "./fixtures";

const editing: BarContext = { ...EMPTY_CONTEXT, hasEditor: true, selection: "some text" };

function action(id: string) {
	const found = ACTIONS_BY_ID.get(id);
	if (found === undefined) throw new Error(`no action "${id}"`);
	return found;
}

describe("the registry is reachable", () => {
	it("offers the primary action first for each item kind", () => {
		const file = actionsFor(ACTIONS, fixtureFile("a"), EMPTY_CONTEXT, ALL_AVAILABLE);
		expect(file[0]?.id).toBe("open");

		const command = actionsFor(ACTIONS, fixtureCommand("app:go-back"), EMPTY_CONTEXT, ALL_AVAILABLE);
		expect(command[0]?.id).toBe("run");
	});

	it("hides the core-plugin actions when the plugin is missing", () => {
		const item = fixtureFile("a");
		const withPlugins = actionsFor(ACTIONS, item, EMPTY_CONTEXT, ALL_AVAILABLE).map((a) => a.id);
		const without = actionsFor(ACTIONS, item, EMPTY_CONTEXT, NONE_AVAILABLE).map((a) => a.id);
		expect(withPlugins).toContain("bookmark");
		expect(withPlugins).toContain("append-daily");
		expect(without).not.toContain("bookmark");
		expect(without).not.toContain("append-daily");
		// Ungated actions survive either way.
		expect(without).toContain("open");
	});

	it("offers the selection verbs only while text is selected in an editor", () => {
		const item = fixtureFile("a");
		const idle = actionsFor(ACTIONS, item, EMPTY_CONTEXT, ALL_AVAILABLE).map((a) => a.id);
		const busy = actionsFor(ACTIONS, item, editing, ALL_AVAILABLE).map((a) => a.id);
		expect(idle).not.toContain("text-color");
		expect(busy).toContain("text-color");
		expect(busy).toContain("align");
	});

	it("offers pin on absolutely everything, which is what ⌘P promises", () => {
		for (const item of [fixtureFile("a"), fixtureCommand("x"), fixtureTag("t")]) {
			expect(actionsFor(ACTIONS, item, EMPTY_CONTEXT, ALL_AVAILABLE).map((a) => a.id)).toContain(
				"pin",
			);
		}
	});
});

describe("closesBar", () => {
	it("keeps the bar open for the list-keeping actions", () => {
		expect(closesBar("pin")).toBe(false);
		expect(closesBar("hide")).toBe(false);
	});

	it("closes it for everything that goes somewhere", () => {
		for (const id of ["open", "rename", "move", "delete", "insert-link", "run-command-on"]) {
			expect(closesBar(id), id).toBe(true);
		}
	});
});

describe("nextArgument — the multi-step flow", () => {
	it("returns null for a single-step action", () => {
		expect(nextArgument(action("delete"), 0)).toBeNull();
		expect(argumentCount(action("delete"))).toBe(0);
	});

	it("hands out the folder picker for Move to…, then stops", () => {
		const move = action("move");
		expect(argumentCount(move)).toBe(1);
		expect(nextArgument(move, 0)).toEqual({ kind: "folder", prompt: "Move to folder" });
		expect(nextArgument(move, 1)).toBeNull();
	});

	it("hands out the colour picker for a colour action", () => {
		expect(nextArgument(action("text-color"), 0)?.kind).toBe("color");
		expect(nextArgument(action("background-color"), 0)?.kind).toBe("color");
		expect(nextArgument(action("align"), 0)?.kind).toBe("align");
	});

	it("hands out a text field for rename and extract", () => {
		expect(nextArgument(action("rename"), 0)).toEqual({
			kind: "text",
			prompt: "New name",
			placeholder: "Name",
		});
		expect(nextArgument(action("extract-note"), 0)?.kind).toBe("text");
	});

	it("never returns an argument past the end, however far the stack is off", () => {
		expect(nextArgument(action("move"), 7)).toBeNull();
	});
});

describe("pins", () => {
	it("adds and removes by item id", () => {
		expect(togglePinned([], "file:a.md")).toEqual(["file:a.md"]);
		expect(togglePinned(["file:a.md"], "file:a.md")).toEqual([]);
		expect(isPinned(["file:a.md"], "file:a.md")).toBe(true);
	});

	it("keeps the other pins and their order", () => {
		expect(togglePinned(["a", "b", "c"], "b")).toEqual(["a", "c"]);
		expect(togglePinned(["a", "b"], "c")).toEqual(["a", "b", "c"]);
	});

	it("never mutates the list it was given", () => {
		const pins = ["a"];
		togglePinned(pins, "b");
		expect(pins).toEqual(["a"]);
	});

	/**
	 * The mismatch that already killed one feature in this repo: pins are keyed
	 * by item.id, and for a file that id is fileItemId(path), not the path.
	 */
	it("stores exactly the id the ranker looks up", () => {
		const file = fixtureFile("alpha");
		expect(togglePinned([], file.id)).toEqual([file.id]);
	});
});

describe("hidden commands", () => {
	const command = fixtureCommand("editor:toggle-bold", "Toggle bold");

	it("toggles by raw command id", () => {
		expect(toggleHidden([], "editor:toggle-bold")).toEqual(["editor:toggle-bold"]);
		expect(toggleHidden(["editor:toggle-bold"], "editor:toggle-bold")).toEqual([]);
	});

	it("hides only the matching command", () => {
		const hidden = new Set(["editor:toggle-bold"]);
		expect(isHiddenItem(command, hidden)).toBe(true);
		expect(isHiddenItem(fixtureCommand("app:go-back"), hidden)).toBe(false);
	});

	it("never hides anything that is not a command", () => {
		// A file whose id happens to collide must survive — only commands hide.
		const hidden = new Set(["alpha", "file:notes/alpha.md"]);
		expect(isHiddenItem(fixtureFile("alpha"), hidden)).toBe(false);
		expect(isHiddenItem(fixtureTag("alpha"), hidden)).toBe(false);
	});

	it("filters a candidate list before ranking", () => {
		const candidates = [command, fixtureFile("a"), fixtureCommand("app:go-back")].map(
			(item: OmniItem) => ({ item, norm: 1 }),
		);
		const kept = withoutHidden(candidates, new Set(["editor:toggle-bold"]));
		expect(kept.map((c) => c.item.id)).toEqual(["a", "app:go-back"]);
	});

	it("returns the very same array when nothing is hidden", () => {
		const candidates = [{ item: command, norm: 1 }];
		expect(withoutHidden(candidates, new Set())).toBe(candidates);
	});
});

describe("query history — what ↑ and ↓ do", () => {
	const history = ["third", "second", "first"]; // newest first

	it("does nothing at all when there is no history", () => {
		expect(historyStep(0, -1, 1)).toBe(-1);
		expect(historyQuery([], -1)).toBe("");
	});

	it("walks back in time from the live input", () => {
		let index = historyStep(history.length, -1, 1);
		expect(historyQuery(history, index)).toBe("third");
		index = historyStep(history.length, index, 1);
		expect(historyQuery(history, index)).toBe("second");
	});

	it("stops at the oldest entry rather than wrapping", () => {
		expect(historyStep(3, 2, 1)).toBe(2);
	});

	it("walks forward again and lands back on the empty input", () => {
		const index = historyStep(3, 0, -1);
		expect(index).toBe(-1);
		expect(historyQuery(history, index)).toBe("");
	});

	it("never goes past the live input", () => {
		expect(historyStep(3, -1, -1)).toBe(-1);
	});

	it("returns empty text for an index the list no longer has", () => {
		expect(historyQuery(history, 99)).toBe("");
	});
});
