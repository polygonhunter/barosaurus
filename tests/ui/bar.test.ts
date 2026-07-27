// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Notice, type App } from "obsidian";
import { historyQuery, historyStep } from "../../src/core/actions";
import { ALL_SOURCES } from "../../src/main";
import { choose, runAction, type ExecuteHost } from "../../src/ui/execute";
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

/**
 * Every bar opened in a test, so it can be closed again.
 *
 * Leaving them open is not tidy-up pedantry: each modal keeps a live
 * MutationObserver on its own result list, and several of them alive at once
 * made the whole file hang while every test passed in isolation.
 */
const opened: OmnibarModal[] = [];

afterEach(() => {
	while (opened.length > 0) opened.pop()?.close();
	document.body.empty();
});

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
	opened.push(modal);
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

/** Every rendered row, group overlines included — the DOM the user scrolls. */
function allRows(modal: OmnibarModal): HTMLElement[] {
	return Array.from(modal.resultContainerEl.querySelectorAll<HTMLElement>(".suggestion-item"));
}

/**
 * Only the rows that are results.
 *
 * groupRows interleaves an overline per group, so three commands render as FOUR
 * rows. Counting all of them is how the first version of this file spent its
 * whole timeout waiting for a condition that could never hold, then reported a
 * product bug it had never actually reached.
 */
function itemRows(modal: OmnibarModal): HTMLElement[] {
	return allRows(modal).filter((el) => !el.hasClass("barosaurus-group-row"));
}

function rowTitles(modal: OmnibarModal): string[] {
	return itemRows(modal).map((el) => el.textContent ?? "");
}

/**
 * Let the suggestion pipeline finish.
 *
 * A fixed number of turns rather than `vi.waitFor`: a waitFor that never comes
 * true reports a timeout, and a timeout tells you nothing about what the bar
 * actually showed. Three turns cover the async getSuggestions plus a streaming
 * source folding in behind it.
 */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 3; turn += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

/**
 * The bar driven by ALL_SOURCES — the registry the plugin actually ships.
 *
 * Every other case in this file hands the modal a fixture source, which proves
 * the modal works and proves nothing about whether a source is wired up. An
 * entry that exists in a catalog, is unit-tested, and is in no registry is the
 * exact failure this repo keeps hitting, so these cases go through the real
 * list. Sources that need more App than the fake offers throw, the modal logs
 * and carries on — which is the documented degraded behaviour, not a shortcut.
 */
function openRealBar(host: Partial<ExecuteHost> = {}): OmnibarModal {
	const app = {
		vault: {
			getFileByPath: () => null,
			getResourcePath: () => "",
			getFiles: () => [],
			getMarkdownFiles: () => [],
			getAllLoadedFiles: () => [],
		},
		workspace: {
			getActiveViewOfType: () => null,
			getActiveFile: () => null,
			getLastOpenFiles: () => [],
			iterateAllLeaves: () => undefined,
		},
		metadataCache: { getTags: () => ({}), resolvedLinks: {}, unresolvedLinks: {} },
	} as unknown as App;

	const executeHost: ExecuteHost = { app, remember: () => undefined, ...host };
	const modal = new OmnibarModal(app, {
		sources: ALL_SOURCES,
		showPreview: false,
		onChoose: (item, _evt, paneType) => void choose(executeHost, item, paneType),
	});
	modal.open();
	opened.push(modal);
	return modal;
}

/** The versions and platform the support link is supposed to carry. */
const TEST_SUPPORT_INFO = {
	pluginVersion: "9.9.9",
	obsidianVersion: "1.12.4",
	platform: "linux",
};

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

	// groupRows interleaves an overline per group, and the list wraps, so the
	// selection lands on one sooner or later. activeItem() returns null while
	// it sits there — and ⌘K, Tab and ⌘P all go through activeItem().
	it("never rests the selection on a group overline", async () => {
		const { modal } = openBar(three, []);
		await vi.waitFor(() => expect(itemRows(modal).length).toBe(3));

		const selectedEl = (): HTMLElement | undefined =>
			allRows(modal).find((el) => el.hasClass("is-selected"));

		expect(selectedEl()?.hasClass("barosaurus-group-row"), "first paint").toBe(false);
		expect(modal.activeItem(), "first paint").not.toBeNull();

		// Twice around, so the wrap past the overline is covered in both
		// directions rather than assumed.
		for (const key of ["ArrowDown", "ArrowUp"]) {
			for (let step = 1; step <= 8; step++) {
				press(modal, key);
				expect(
					selectedEl()?.hasClass("barosaurus-group-row"),
					`${key} #${step} stopped on an overline`,
				).toBe(false);
				expect(modal.activeItem(), `${key} #${step}`).not.toBeNull();
			}
		}
	});
});

describe("the executor reaches Obsidian", () => {
	// "Not a single command works." The modal hands the item over correctly —
	// that is asserted above — so the next link in the chain is this one.
	it("runs a command through the command registry, by id", async () => {
		const ran: string[] = [];
		const app = {
			commands: {
				executeCommandById: (id: string) => {
					ran.push(id);
					return true;
				},
			},
		} as unknown as Parameters<typeof choose>[0]["app"];

		await choose({ app, remember: () => undefined }, commandItem("bold", "Bold"), false);

		expect(ran, "the command never reached executeCommandById").toEqual(["test:bold"]);
	});

	// "Commands work, actions do not." choose() handled exactly two
	// prefix-encoded action ids and fell out of the switch for every other
	// verb, so an action picked with Enter did nothing and said nothing. The
	// dispatcher was only ever reached from the ⌘K panel.
	it("routes an action verb through the dispatcher", async () => {
		// The harness records notices; the real typings know nothing of it, and
		// tsc checks this file against those.
		const shown = (Notice as unknown as { shown: string[] }).shown;
		shown.length = 0;
		const action = {
			kind: "action",
			source: "action",
			group: "actions",
			id: "wrap-callout",
			title: "Wrap in callout",
			aliases: [],
			actionId: "wrap-callout",
			tile: { kind: "icon", icon: "quote" },
		} as unknown as OmniItem;

		// No editor is open, so a verb that reached the dispatcher says so.
		// Silence is the failure: that is what shipped.
		const app = { workspace: { getActiveViewOfType: () => null } } as never;
		await choose({ app, remember: () => undefined }, action, false);

		expect(shown.join(" "), "the action verb was swallowed").toContain("no editor");
	});
});

describe("bug reporting is discoverable from the bar", () => {
	beforeEach(() => {
		document.body.empty();
	});

	/**
	 * The defect this covers: `supportUrl()` built a contact URL carrying the
	 * plugin version, the Obsidian version and the platform, `openSupport()`
	 * opened it — and the only caller in the whole plugin was a button in
	 * Settings → About. A user in trouble types their problem into the bar, and
	 * the bar answered every one of these words with nothing.
	 */
	const CONTACT_WORDS = ["bug", "support", "help", "feedback", "contact", "problem", "report"];
	const GITHUB_WORDS = ["issue", "github", "feature request"];

	for (const word of CONTACT_WORDS) {
		it(`“${word}” surfaces the contact entry`, async () => {
			const modal = openRealBar();
			type(modal, word);
			await settle();

			expect(
				rowTitles(modal).join(" | "),
				`typing “${word}” offers no way to report a bug`,
			).toContain("Report a bug or get in touch");
		});
	}

	for (const word of GITHUB_WORDS) {
		it(`“${word}” surfaces the GitHub entry`, async () => {
			const modal = openRealBar();
			type(modal, word);
			await settle();

			expect(
				rowTitles(modal).join(" | "),
				`typing “${word}” offers no route to the issue tracker`,
			).toContain("Open an issue on GitHub");
		});
	}

	/**
	 * The other half of the bargain.
	 *
	 * `groupRows` orders groups strictly by GROUP_ORDER and Actions leads it, so
	 * anything these entries match is pushed above every command and every note
	 * — there is no score that can outrank a group. Recall is a subsequence
	 * check, so a bare "b" reaches "bug" and a bare "h" reaches "help": the two
	 * most ordinary first keystrokes there are would open with a support link
	 * instead of Bold. Discoverable must not mean unavoidable.
	 */
	for (const stray of ["b", "h", "c", "r", "is"]) {
		it(`stays out of the way of “${stray}”`, async () => {
			const modal = openRealBar();
			type(modal, stray);
			await settle();

			const titles = rowTitles(modal).join(" | ");
			expect(titles, `typing “${stray}” put the contact entry at the top of the bar`).not.toContain(
				"Report a bug or get in touch",
			);
			expect(titles, `typing “${stray}” put the GitHub entry at the top of the bar`).not.toContain(
				"Open an issue on GitHub",
			);
		});
	}

	// The Actions group leads GROUP_ORDER, so this is also where a person who
	// typed "help" will look first.
	it("files both entries under Actions", async () => {
		const modal = openRealBar();
		type(modal, "bug");
		await settle();

		const groups = allRows(modal)
			.filter((el) => el.hasClass("barosaurus-group-row"))
			.map((el) => el.textContent ?? "");

		expect(groups.join(" | "), "the help entries are not in the Actions group").toContain(
			"Actions",
		);
	});
});

describe("choosing the help entry opens the link, and nothing else does", () => {
	beforeEach(() => {
		document.body.empty();
	});

	/**
	 * Both halves of the README's privacy promise in one case: the browser
	 * opens on an explicit pick and at no other moment. Merely LISTING the
	 * entry must not fire, or "Barosaurus makes no network requests on its own"
	 * stops being true the moment someone types "b".
	 */
	it("opens the contact URL on Enter and not before", async () => {
		const opened: string[] = [];
		const modal = openRealBar({
			openExternal: (url: string) => opened.push(url),
			supportInfo: () => TEST_SUPPORT_INFO,
		});
		type(modal, "report a bug");
		await settle();

		expect(rowTitles(modal)[0] ?? "", "the entry is not the top hit for its own name").toContain(
			"Report a bug or get in touch",
		);
		expect(opened, "a link opened merely from listing the entry").toEqual([]);

		press(modal, "Enter");
		await settle();

		expect(opened, "Enter on the entry never reached the URL opener").toHaveLength(1);
		const url = opened[0] ?? "";
		expect(url, "the contact URL is not the one supportUrl() builds").toContain(
			"polygonhunter.com",
		);
		expect(url, "the report would arrive without the plugin version").toContain("9.9.9");
		expect(url, "the report would arrive without the platform").toContain("linux");
	});

	// Straight at the dispatcher: the ⌘K panel calls runAction directly, so a
	// verb that only works through choose() is half-wired.
	it("routes the support verb through runAction", async () => {
		const opened: string[] = [];
		await runAction(
			{
				app: {} as never,
				remember: () => undefined,
				openExternal: (url: string) => opened.push(url),
				supportInfo: () => TEST_SUPPORT_INFO,
			},
			"report-bug",
			helpItem("report-bug"),
		);

		expect(opened, "the support verb never reached the URL opener").toHaveLength(1);
		expect(opened[0] ?? "").toContain("version=9.9.9");
		expect(opened[0] ?? "").toContain("platform=linux");
	});

	it("routes the GitHub verb through runAction", async () => {
		const opened: string[] = [];
		await runAction(
			{
				app: {} as never,
				remember: () => undefined,
				openExternal: (url: string) => opened.push(url),
				supportInfo: () => TEST_SUPPORT_INFO,
			},
			"open-issues",
			helpItem("open-issues"),
		);

		expect(opened, "the GitHub verb never reached the URL opener").toEqual([
			"https://github.com/polygonhunter/barosaurus/issues",
		]);
	});

	// A host with no opener wired must say so rather than throw — the same
	// degraded contract every other optional member of ExecuteHost has.
	it("says so when the host has no way to open a link", async () => {
		const shown = (Notice as unknown as { shown: string[] }).shown;
		shown.length = 0;

		await runAction(
			{ app: {} as never, remember: () => undefined },
			"report-bug",
			helpItem("report-bug"),
		);

		// Naming the link is the point: "that action is not available yet" is
		// what an unrouted verb already says, so asserting anything vaguer than
		// this would pass against the defect.
		expect(shown.join(" "), "a host without an opener said nothing about links").toContain(
			"link",
		);
	});
});

function helpItem(actionId: string): OmniItem {
	return {
		kind: "action",
		source: "command",
		group: "actions",
		id: `help:${actionId}`,
		title: "Report a bug or get in touch",
		aliases: [],
		actionId,
		tile: { kind: "icon", icon: "life-buoy" },
	} as OmniItem;
}
