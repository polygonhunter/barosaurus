import { describe, expect, it } from "vitest";
import { argumentCount, nextArgument } from "../src/core/actions";
import type { ActionDef } from "../src/core/types";
import {
	breadcrumbs,
	collectedValues,
	createStack,
	current,
	depth,
	isRoot,
	pop,
	push,
	resolveBack,
	setQuery,
	setValue,
	type PageStackState,
} from "../src/core/pagestack";

const folderPage = { kind: "folder", label: "Move to…" };
const colorPage = { kind: "color", label: "Colour" };

/** Root → folder → colour, with a value collected on each pushed level. */
function twoDeep(): PageStackState {
	let state = push(createStack(), folderPage);
	state = setValue(state, "Projects/");
	state = push(state, colorPage);
	return setValue(state, "red");
}

describe("a fresh stack", () => {
	it("is at the root with depth 0", () => {
		const state = createStack();
		expect(isRoot(state)).toBe(true);
		expect(depth(state)).toBe(0);
		expect(current(state).kind).toBe("root");
		expect(current(state).query).toBe("");
	});

	it("has no breadcrumbs and no collected values", () => {
		expect(breadcrumbs(createStack())).toEqual([]);
		expect(collectedValues(createStack())).toEqual([]);
	});
});

describe("push and pop", () => {
	it("pushes a level with its own empty query", () => {
		const state = push(createStack(), folderPage);
		expect(depth(state)).toBe(1);
		expect(isRoot(state)).toBe(false);
		expect(current(state)).toEqual({ kind: "folder", label: "Move to…", query: "" });
	});

	it("pops back to the root", () => {
		const state = push(createStack(), folderPage);
		const popped = pop(state);
		expect(isRoot(popped)).toBe(true);
		expect(depth(popped)).toBe(0);
		expect(current(popped).kind).toBe("root");
	});

	it("returns the SAME state when popping at the root — the close signal", () => {
		const root = createStack();
		expect(pop(root)).toBe(root);
	});

	it("stacks several levels", () => {
		const state = twoDeep();
		expect(depth(state)).toBe(2);
		expect(current(state).kind).toBe("color");
		expect(depth(pop(state))).toBe(1);
	});

	it("does not mutate the state it pops from", () => {
		const state = push(createStack(), folderPage);
		pop(state);
		expect(depth(state)).toBe(1);
	});
});

describe("resolveBack — Esc and Backspace-on-empty", () => {
	it("closes at the root", () => {
		expect(resolveBack(createStack())).toEqual({ action: "close" });
	});

	it("pops anywhere else", () => {
		expect(resolveBack(push(createStack(), folderPage))).toEqual({ action: "pop" });
		expect(resolveBack(twoDeep())).toEqual({ action: "pop" });
	});
});

describe("per-level queries", () => {
	it("keeps each level's query across push and pop", () => {
		let state = setQuery(createStack(), "bold");
		state = push(state, folderPage);
		expect(current(state).query).toBe("");

		state = setQuery(state, "projects");
		expect(current(state).query).toBe("projects");

		state = pop(state);
		expect(current(state).query).toBe("bold");
	});

	it("setQuery never mutates the input state", () => {
		const state = createStack();
		const next = setQuery(state, "bold");
		expect(current(state).query).toBe("");
		expect(next).not.toBe(state);
		expect(next.pages).not.toBe(state.pages);
		expect(current(next).query).toBe("bold");
	});

	it("setValue never mutates the input state", () => {
		const state = push(createStack(), folderPage);
		const next = setValue(state, "Projects/");
		expect(current(state).value).toBeUndefined();
		expect(next).not.toBe(state);
		expect(next.pages).not.toBe(state.pages);
		expect(current(next).value).toBe("Projects/");
	});

	it("setValue leaves the query alone and vice versa", () => {
		let state = push(createStack(), folderPage);
		state = setQuery(state, "proj");
		state = setValue(state, "Projects/");
		expect(current(state)).toEqual({
			kind: "folder",
			label: "Move to…",
			query: "proj",
			value: "Projects/",
		});
	});
});

describe("breadcrumbs and collected values", () => {
	it("excludes the root from the breadcrumbs", () => {
		const crumbs = breadcrumbs(twoDeep());
		expect(crumbs.map((page) => page.label)).toEqual(["Move to…", "Colour"]);
	});

	it("returns the values in push order", () => {
		expect(collectedValues(twoDeep())).toEqual(["Projects/", "red"]);
	});

	it("skips levels that collected no value", () => {
		let state = push(createStack(), folderPage);
		state = setValue(state, "Projects/");
		state = push(state, { kind: "confirm", label: "Confirm" });
		state = push(state, colorPage);
		state = setValue(state, "red");
		expect(depth(state)).toBe(3);
		expect(collectedValues(state)).toEqual(["Projects/", "red"]);
	});

	it("ignores a value set on the root", () => {
		const state = setValue(createStack(), "ignored");
		expect(collectedValues(state)).toEqual([]);
		expect(breadcrumbs(state)).toEqual([]);
	});
});

/**
 * Two arguments in a row.
 *
 * `nextArgument`/`argumentCount` were written for N arguments and the recursion
 * in `advance` (src/ui/action-panel.ts:178) says as much in its comment, but
 * every one of the thirty actions declares exactly one. The two-argument path
 * has therefore never run. "Set property…" is the first action to need it, so
 * the contract gets pinned down before anything depends on it.
 *
 * This mirrors `advance` step for step: read what has been collected, ask for
 * the next picker, push a level, commit a value, repeat until there is no next
 * picker. The panel level itself is pushed first and never collects, which is
 * exactly why `collectedValues` has to skip valueless levels.
 */
describe("a two-argument flow", () => {
	const twoArg: ActionDef = {
		id: "set-property",
		name: "Set property…",
		aliases: [],
		icon: "list-plus",
		appliesTo: () => true,
		arguments: [
			{ kind: "property", prompt: "Property" },
			{ kind: "text", prompt: "Value", placeholder: "Value" },
		],
	};

	/** The loop from `advance`, with the picker choices supplied up front. */
	function runFlow(action: ActionDef, choices: readonly string[]): string[] {
		// Level 1 is the ⌘K panel: pushed, never given a value.
		let state = push(createStack(), { kind: "actions", label: "Actions" });
		for (let guard = 0; guard < 10; guard += 1) {
			const collected = collectedValues(state);
			const picker = nextArgument(action, collected.length);
			if (picker === null) return collected;
			state = push(state, { kind: picker.kind, label: picker.prompt });
			const choice = choices[collected.length];
			if (choice !== undefined) state = setValue(state, choice);
		}
		throw new Error("flow did not terminate");
	}

	it("reports two arguments", () => {
		expect(argumentCount(twoArg)).toBe(2);
	});

	it("asks for the second picker only after the first has a value", () => {
		let state = push(createStack(), { kind: "actions", label: "Actions" });
		expect(nextArgument(twoArg, collectedValues(state).length)?.prompt).toBe("Property");

		state = push(state, { kind: "property", label: "Property" });
		// Pushed but not chosen yet: still argument one, or the flow would skip
		// a step every time a picker took a moment.
		expect(nextArgument(twoArg, collectedValues(state).length)?.prompt).toBe("Property");

		state = setValue(state, "author");
		expect(nextArgument(twoArg, collectedValues(state).length)?.prompt).toBe("Value");
	});

	it("hands the action both values in push order", () => {
		expect(runFlow(twoArg, ["author", "Ada Lovelace"])).toEqual(["author", "Ada Lovelace"]);
	});

	it("stops asking once both are collected", () => {
		let state = push(createStack(), { kind: "actions", label: "Actions" });
		state = setValue(push(state, { kind: "property", label: "Property" }), "author");
		state = setValue(push(state, { kind: "text", label: "Value" }), "Ada Lovelace");
		expect(nextArgument(twoArg, collectedValues(state).length)).toBeNull();
	});

	it("still works for the one-argument actions that ship today", () => {
		const oneArg: ActionDef = {
			...twoArg,
			id: "move",
			arguments: [{ kind: "folder", prompt: "Move to folder" }],
		};
		expect(argumentCount(oneArg)).toBe(1);
		expect(runFlow(oneArg, ["Projects/"])).toEqual(["Projects/"]);
	});
});
