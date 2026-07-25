import { describe, expect, it } from "vitest";
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
