// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { historyQuery, historyStep } from "../../src/core/actions";
import { OmnibarModal } from "../../src/ui/omnibar-modal";
import type { Candidate, OmniItem } from "../../src/core/types";
import type { Source, SourceContext } from "../../src/sources/source";

/**
 * The bar, actually running.
 *
 * Everything under src/ui had never been executed by anything until this file:
 * four releases went out green while the modal could not even be constructed.
 * These cases drive it the way a person does — type, arrow, Enter — and assert
 * what the user would see happen.
 */

function commandItem(id: string, title: string): OmniItem {
	return {
		kind: "command",
		source: "command",
		group: "commands",
		id,
		title,
		aliases: [],
		commandId: `test:${id}`,
		tile: { kind: "icon", icon: "command" },
	} as OmniItem;
}

function sourceOf(items: readonly OmniItem[]): Source {
	return {
		id: "test",
		appliesTo: () => true,
		getCandidates: (_ctx: SourceContext): Candidate[] =>
			items.map((item) => ({ item, norm: 1 }) as Candidate),
	};
}

interface Harnessed {
	modal: OmnibarModal;
	chosen: ReturnType<typeof vi.fn>;
}

function openBar(items: readonly OmniItem[], history: string[] = []): Harnessed {
	const chosen = vi.fn();
	const app = {
		vault: { getFileByPath: () => null, getResourcePath: () => "" },
		workspace: { getActiveViewOfType: () => null },
	} as unknown as App;

	const modal = new OmnibarModal(app, {
		sources: [sourceOf(items)],
		onChoose: chosen,
		showPreview: false,
		actions: {
			actionsFor: () => [],
			openPanel: () => undefined,
			run: () => undefined,
			runIfApplicable: () => false,
			hidden: () => new Set<string>(),
			history: () => history,
			rememberQuery: () => undefined,
			// The REAL steppers, bound to this history. Stubbing these was how
			// the first version of this file passed while the bug was live: it
			// asserted against a stand-in instead of the shipped logic.
			historyStep: (index: number, direction: 1 | -1) =>
				historyStep(history.length, index, direction),
			historyQuery: (index: number) => historyQuery(history, index),
		} as never,
	});
	modal.open();
	return { modal, chosen };
}

/** A real, bubbling keydown on the input — the same path a user's key takes. */
function press(modal: OmnibarModal, key: string, mods: Partial<KeyboardEvent> = {}): void {
	const evt = new KeyboardEvent("keydown", {
		key,
		code: key,
		bubbles: true,
		cancelable: true,
		...mods,
	});
	modal.inputEl.dispatchEvent(evt);
}

function type(modal: OmnibarModal, text: string): void {
	modal.inputEl.value = text;
	modal.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
}

function rowTitles(modal: OmnibarModal): string[] {
	return Array.from(
		modal.resultContainerEl.querySelectorAll<HTMLElement>(".suggestion-item"),
	).map((el) => el.textContent ?? "");
}

describe("the bar opens and lists results", () => {
	beforeEach(() => {
		document.body.empty();
	});

	it("constructs and opens without throwing", async () => {
		const { modal } = openBar([commandItem("bold", "Bold")]);
		await vi.waitFor(() => expect(rowTitles(modal).length).toBeGreaterThan(0));
	});

	it("shows a typed query's matches", async () => {
		const { modal } = openBar([commandItem("bold", "Bold"), commandItem("italic", "Italic")]);
		type(modal, "bold");
		await vi.waitFor(() => {
			expect(rowTitles(modal).join(" ")).toContain("Bold");
		});
	});
});

describe("Enter runs the highlighted result", () => {
	beforeEach(() => {
		document.body.empty();
	});

	// The headline symptom: "not a single command works".
	it("hands the highlighted item to onChoose", async () => {
		const { modal, chosen } = openBar([commandItem("bold", "Bold")]);
		type(modal, "bold");
		await vi.waitFor(() => expect(rowTitles(modal).length).toBeGreaterThan(0));

		press(modal, "Enter");

		expect(chosen).toHaveBeenCalledTimes(1);
		const [item] = chosen.mock.calls[0] as [OmniItem];
		expect(item.id).toBe("bold");
	});
});

describe("the arrow keys always lead back to the list", () => {
	beforeEach(() => {
		document.body.empty();
	});

	const three = [
		commandItem("a", "Alpha"),
		commandItem("b", "Beta"),
		commandItem("c", "Gamma"),
	];

	/** Which row is highlighted — the only thing the user can actually see. */
	function selectedIndex(modal: OmnibarModal): number {
		return (modal as unknown as { harnessSelectedIndex: number }).harnessSelectedIndex;
	}

	// With no history there is nothing to recall, so ArrowUp belongs to the
	// list. Swallowing it makes the key dead on a fresh install — which is
	// every install, the first time.
	it("moves the selection with ArrowUp when there is no history", async () => {
		const { modal } = openBar(three, []);
		await vi.waitFor(() => expect(rowTitles(modal).length).toBe(3));

		press(modal, "ArrowDown");
		const afterDown = selectedIndex(modal);
		press(modal, "ArrowUp");

		expect(selectedIndex(modal), "an empty history ate the arrow key").not.toBe(afterDown);
	});

	// "Once you have gone into the search area with the arrows you cannot get
	// back." At the oldest entry the walk must hand the key back, not hold it.
	it("gives the key back to the list at the end of the history", async () => {
		const { modal } = openBar(three, ["older"]);
		await vi.waitFor(() => expect(rowTitles(modal).length).toBe(3));

		press(modal, "ArrowUp"); // into the walk, recalls "older"
		const inWalk = selectedIndex(modal);
		press(modal, "ArrowUp"); // nothing older left — must move the selection

		expect(selectedIndex(modal), "the history walk kept the arrow key").not.toBe(inWalk);
	});
});
