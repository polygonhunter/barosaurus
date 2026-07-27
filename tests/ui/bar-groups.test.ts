// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { OmnibarModal } from "../../src/ui/omnibar-modal";
import type { Candidate, GroupId, OmniItem } from "../../src/core/types";
import type { Source, SourceContext } from "../../src/sources/source";

/**
 * Arrow navigation ACROSS GROUP BOUNDARIES.
 *
 * Every other case in tests/ui/bar.test.ts runs on a single group, so the only
 * overline in the list is the one at row 0 — which is exactly why the reported
 * defect survived: "↑ from Notes and files into Open tabs needs more than one
 * press". A boundary only exists once two groups do, so everything here is
 * driven by a three-group fixture.
 *
 * The invariant these cases pin down: ONE key press moves the selection by
 * exactly ONE ITEM, however many overlines sit between the two.
 */

function item(group: GroupId, id: string, title: string): OmniItem {
	return {
		kind: "command",
		source: "command",
		group,
		id,
		title,
		aliases: [],
		commandId: `test:${id}`,
		tile: { kind: "icon", icon: "command" },
	} as OmniItem;
}

/** Three groups, in GROUP_ORDER: Commands, Open tabs, Notes and files. */
const FIXTURE: readonly OmniItem[] = [
	item("commands", "c1", "Command one"),
	item("commands", "c2", "Command two"),
	item("openTabs", "t1", "Tab one"),
	item("openTabs", "t2", "Tab two"),
	item("files", "f1", "File one"),
	item("files", "f2", "File two"),
];

/** The item titles in render order — what a single press must walk through. */
const ORDER = FIXTURE.map((entry) => entry.title);
/** Six items across three groups render as nine rows. */
const ROW_COUNT = FIXTURE.length + 3;

function sourceOf(items: readonly OmniItem[]): Source {
	return {
		id: "test",
		appliesTo: () => true,
		getCandidates: (_ctx: SourceContext): Candidate[] =>
			items.map((entry) => ({ item: entry, norm: 1 }) as Candidate),
	};
}

const opened: OmnibarModal[] = [];

// Each modal keeps a live MutationObserver on its own list; leaving them open
// hangs the whole file even while every case passes on its own.
afterEach(() => {
	while (opened.length > 0) opened.pop()?.close();
	document.body.empty();
});

function openBar(items: readonly OmniItem[] = FIXTURE): OmnibarModal {
	const app = {
		vault: { getFileByPath: () => null, getResourcePath: () => "" },
		workspace: { getActiveViewOfType: () => null },
	} as unknown as App;
	const modal = new OmnibarModal(app, { sources: [sourceOf(items)], showPreview: false });
	modal.open();
	opened.push(modal);
	return modal;
}

/** A real, bubbling keydown on the input — the same path a user's key takes. */
function press(modal: OmnibarModal, key: string): void {
	modal.inputEl.dispatchEvent(
		new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }),
	);
}

/**
 * The same key, reaching Obsidian's own arrow handling instead of the bar's.
 *
 * The bar claims the arrows with a capture listener on `inputEl` and swallows
 * them; anything that moves the selection WITHOUT going through that listener
 * lands Obsidian's own one-row move on the list. That is not hypothetical — a
 * key pressed while focus is not in the input, and the chooser's own
 * select-on-hover, both do exactly this — and the bar's safety net is supposed
 * to carry the selection off the overline afterwards.
 */
function pressPastTheBar(modal: OmnibarModal, key: string): void {
	modal.containerEl.dispatchEvent(
		new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }),
	);
}

function type(modal: OmnibarModal, text: string): void {
	modal.inputEl.value = text;
	modal.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
}

function allRows(modal: OmnibarModal): HTMLElement[] {
	return Array.from(modal.resultContainerEl.querySelectorAll<HTMLElement>(".suggestion-item"));
}

function selectedEl(modal: OmnibarModal): HTMLElement | undefined {
	return allRows(modal).find((el) => el.hasClass("is-selected"));
}

/** The highlighted row's title, or a marker naming what went wrong instead. */
function selectedTitle(modal: OmnibarModal): string {
	const el = selectedEl(modal);
	if (el === undefined) return "<nothing selected>";
	if (el.hasClass("barosaurus-group-row")) return `<overline: ${el.textContent ?? ""}>`;
	// renderRow appends the ⌘-pick ordinal to the row's text, so match on the
	// title rather than comparing the whole textContent.
	return ORDER.find((title) => (el.textContent ?? "").includes(title)) ?? (el.textContent ?? "");
}

/** Walk the selection to a named item with single presses; fails loudly if it never arrives. */
function walkTo(modal: OmnibarModal, title: string): Promise<void> {
	return (async () => {
		for (let step = 0; step < ROW_COUNT * 2; step += 1) {
			if (selectedTitle(modal) === title) return;
			press(modal, "ArrowDown");
			await settle();
		}
		throw new Error(`could not reach “${title}”; stopped on “${selectedTitle(modal)}”`);
	})();
}

/**
 * Let the suggestion pipeline and the selection observer finish. A fixed number
 * of turns rather than vi.waitFor: a timeout says nothing about what the bar
 * actually showed.
 */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 3; turn += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

async function openSettled(items: readonly OmniItem[] = FIXTURE): Promise<OmnibarModal> {
	const modal = openBar(items);
	await vi.waitFor(() => expect(allRows(modal).length).toBe(items.length + 3));
	await settle();
	return modal;
}

describe("one press crosses a group boundary", () => {
	beforeEach(() => {
		document.body.empty();
	});

	it("lists three groups, so there are real boundaries to cross", async () => {
		const modal = await openSettled();
		const overlines = allRows(modal)
			.filter((el) => el.hasClass("barosaurus-group-row"))
			.map((el) => el.textContent ?? "");
		expect(overlines).toHaveLength(3);
		expect(overlines.join(" | ")).toContain("Open tabs");
	});

	// The report, verbatim: "from Notes and files up into Open tabs".
	it("↑ from the first note lands on the last open tab", async () => {
		const modal = await openSettled();
		await walkTo(modal, "File one");

		press(modal, "ArrowUp");
		await settle();

		expect(selectedTitle(modal), "one ↑ did not cross into Open tabs").toBe("Tab two");
	});

	// And the second half of it: "from Open tabs up into Commands".
	it("↑ from the first open tab lands on the last command", async () => {
		const modal = await openSettled();
		await walkTo(modal, "Tab one");

		press(modal, "ArrowUp");
		await settle();

		expect(selectedTitle(modal), "one ↑ did not cross into Commands").toBe("Command two");
	});

	it("↓ from the last command lands on the first open tab", async () => {
		const modal = await openSettled();
		await walkTo(modal, "Command two");

		press(modal, "ArrowDown");
		await settle();

		expect(selectedTitle(modal), "one ↓ did not cross into Open tabs").toBe("Tab one");
	});

	it("↓ from the last open tab lands on the first note", async () => {
		const modal = await openSettled();
		await walkTo(modal, "Tab two");

		press(modal, "ArrowDown");
		await settle();

		expect(selectedTitle(modal), "one ↓ did not cross into Notes and files").toBe("File one");
	});
});

describe("the whole list, one press at a time", () => {
	beforeEach(() => {
		document.body.empty();
	});

	/**
	 * The assertion that actually pins the behaviour down: the visited sequence
	 * IS the item order. A skip and a stall both show up here, and neither can
	 * hide behind "well, it moved".
	 */
	it("walks top to bottom and back with no repeats and no skips", async () => {
		const modal = await openSettled();
		expect(selectedTitle(modal), "first paint").toBe("Command one");

		const down: string[] = [];
		for (let step = 1; step < ORDER.length; step += 1) {
			press(modal, "ArrowDown");
			await settle();
			expect(selectedEl(modal)?.hasClass("barosaurus-group-row"), `↓ #${step}`).toBe(false);
			expect(modal.activeItem(), `↓ #${step} left no active item`).not.toBeNull();
			down.push(selectedTitle(modal));
		}
		expect(down, "↓ did not walk the item order").toEqual(ORDER.slice(1));

		const up: string[] = [];
		for (let step = 1; step < ORDER.length; step += 1) {
			press(modal, "ArrowUp");
			await settle();
			expect(selectedEl(modal)?.hasClass("barosaurus-group-row"), `↑ #${step}`).toBe(false);
			expect(modal.activeItem(), `↑ #${step} left no active item`).not.toBeNull();
			up.push(selectedTitle(modal));
		}
		expect(up, "↑ did not walk the item order backwards").toEqual(
			ORDER.slice(0, -1).reverse(),
		);
	});

	it("wraps by one item at each end", async () => {
		const modal = await openSettled();

		// ↑ from the very first item is one step: onto the very last one.
		press(modal, "ArrowUp");
		await settle();
		expect(selectedTitle(modal), "↑ off the top did not wrap to the last item").toBe("File two");

		press(modal, "ArrowDown");
		await settle();
		expect(selectedTitle(modal), "↓ off the bottom did not wrap to the first item").toBe(
			"Command one",
		);
	});
});

describe("a selection change the bar did not make", () => {
	beforeEach(() => {
		document.body.empty();
	});

	/**
	 * The defect behind the report.
	 *
	 * Two mechanisms compensate for the same overline. `navigate()` pre-counts
	 * it and steps twice; `syncSelection()` nudges once more whenever the
	 * selection ends up on one — but it nudges in `lastDirection`, the direction
	 * of the last key `navigate()` handled, not the direction of the move that
	 * just happened. Reach an overline going UP while that remembered direction
	 * is DOWN, and the nudge puts the selection back exactly where it came from:
	 * the key does nothing at all, however many times it is pressed.
	 */
	it("carries the selection off an overline in the direction it was travelling", async () => {
		const modal = await openSettled();
		await walkTo(modal, "Tab one"); // arrives going DOWN, so lastDirection is ↓
		expect(selectedTitle(modal)).toBe("Tab one");

		pressPastTheBar(modal, "ArrowUp");
		await settle();

		expect(
			selectedTitle(modal),
			"↑ onto the Open tabs overline was nudged back down to where it started",
		).toBe("Command two");
	});

	it("stays off the overline however often that key is pressed", async () => {
		const modal = await openSettled();
		await walkTo(modal, "File one");

		const visited: string[] = [];
		for (let step = 1; step <= 3; step += 1) {
			pressPastTheBar(modal, "ArrowUp");
			await settle();
			expect(selectedEl(modal)?.hasClass("barosaurus-group-row"), `↑ #${step}`).toBe(false);
			visited.push(selectedTitle(modal));
		}

		expect(visited, "the selection never left the boundary").toEqual([
			"Tab two",
			"Tab one",
			"Command two",
		]);
	});

	/**
	 * The same stale direction, reached the way every user reaches it: typing.
	 * A repaint re-selects row 0, which is always an overline, and the nudge
	 * takes it from there — upwards, if the last key happened to be ↑, wrapping
	 * the highlight to the BOTTOM of a freshly typed query.
	 */
	it("starts a freshly typed query at the top even after an ↑", async () => {
		const modal = await openSettled();
		press(modal, "ArrowUp");
		await settle();

		type(modal, "o");
		await settle();

		expect(selectedTitle(modal), "typing flung the highlight to the bottom of the list").toBe(
			"Command one",
		);
		expect(modal.activeItem(), "a freshly typed query has no active item").not.toBeNull();
	});
});
