import { describe, expect, it } from "vitest";
import type { UserSnippet } from "../src/core/blocks";
import {
	blockActionId,
	blockIdFromActionId,
	CALLOUT_TYPES,
	CODE_LANGUAGES,
	findInsertBlock,
	INSERT_ACTION_PREFIX,
	INSERT_BLOCKS,
	insertBlocks,
	snippetBlocks,
} from "../src/core/catalog";
import {
	EDITING_ACTION_IDS,
	handlesEditing,
	normalizeCalloutType,
	normalizeLanguage,
	parseAlignment,
	parseColorName,
	planEdit,
	planFootnote,
	prefixSelection,
	type EditingRequest,
	type EditingSettings,
} from "../src/core/editing";

const NOW = new Date(2026, 2, 9, 8, 5, 4); // Monday, 9 March 2026, 08:05

const SETTINGS: EditingSettings = {
	colorMode: "theme",
	dateFormat: "YYYY-MM-DD",
	snippets: [],
};

function plan(overrides: Partial<EditingRequest> & { actionId: string }) {
	return planEdit({
		selection: "",
		settings: SETTINGS,
		now: NOW,
		...overrides,
	});
}

/** The text a plan produced, or a marker that makes a null read clearly. */
function text(overrides: Partial<EditingRequest> & { actionId: string }): string {
	return plan(overrides)?.text ?? "<null>";
}

// ---------------------------------------------------------------- routing

describe("handlesEditing", () => {
	it("claims every id it can plan", () => {
		for (const id of EDITING_ACTION_IDS) expect(handlesEditing(id)).toBe(true);
	});

	it("claims insert-block ids", () => {
		expect(handlesEditing(blockActionId("date"))).toBe(true);
		expect(handlesEditing(blockActionId("callout-warning"))).toBe(true);
	});

	it("leaves everything else to the executor", () => {
		for (const id of ["open", "rename", "move", "copy-link", "pin", "extract-note"]) {
			expect(handlesEditing(id), id).toBe(false);
		}
	});

	it("returns null rather than guessing for an id it does not own", () => {
		expect(plan({ actionId: "rename", selection: "x" })).toBeNull();
	});
});

// ----------------------------------------------------------------- colour

describe("text-color", () => {
	it("wraps in the documented span, in theme mode", () => {
		expect(text({ actionId: "text-color", selection: "hello", argument: "red" })).toBe(
			'<span style="color: var(--color-red);">hello</span>',
		);
	});

	it("honours hex mode", () => {
		expect(
			text({
				actionId: "text-color",
				selection: "hello",
				argument: "blue",
				settings: { ...SETTINGS, colorMode: "hex" },
			}),
		).toBe('<span style="color: #086ddd;">hello</span>');
	});

	it("toggles the same colour back off", () => {
		const wrapped = text({ actionId: "text-color", selection: "hello", argument: "red" });
		expect(text({ actionId: "text-color", selection: wrapped, argument: "red" })).toBe("hello");
	});

	it("accepts a German colour name", () => {
		expect(text({ actionId: "text-color", selection: "x", argument: "rot" })).toBe(
			'<span style="color: var(--color-red);">x</span>',
		);
	});

	it("refuses an unknown colour instead of picking one", () => {
		expect(plan({ actionId: "text-color", selection: "x", argument: "chartreuse" })).toBeNull();
		expect(plan({ actionId: "text-color", selection: "x" })).toBeNull();
	});

	it("puts the cursor after the wrapper", () => {
		const result = plan({ actionId: "text-color", selection: "hi", argument: "red" });
		expect(result?.cursor).toEqual({ lineDelta: 0, ch: result?.text.length });
	});
});

describe("background-color", () => {
	it("wraps in a mark with a translucent background", () => {
		expect(text({ actionId: "background-color", selection: "hello", argument: "yellow" })).toBe(
			'<mark style="background: rgba(var(--color-yellow-rgb), 0.2);">hello</mark>',
		);
	});

	it("toggles back off", () => {
		const wrapped = text({
			actionId: "background-color",
			selection: "hello",
			argument: "yellow",
		});
		expect(text({ actionId: "background-color", selection: wrapped, argument: "yellow" })).toBe(
			"hello",
		);
	});
});

/**
 * docs/findings.md §1: the docs are explicitly ambiguous about markdown inside
 * an inline span, so the plan hands the fact to the caller instead of assuming
 * one way or the other.
 */
describe("the markdown-inside-HTML gate", () => {
	it("flags a selection carrying markdown that is about to be wrapped", () => {
		expect(
			plan({ actionId: "text-color", selection: "**bold**", argument: "red" })
				?.markdownInsideHtml,
		).toBe(true);
		expect(
			plan({ actionId: "background-color", selection: "a `code` b", argument: "red" })
				?.markdownInsideHtml,
		).toBe(true);
		expect(
			plan({ actionId: "align", selection: "- one\n- two", argument: "center" })
				?.markdownInsideHtml,
		).toBe(true);
	});

	it("stays quiet for plain text", () => {
		expect(
			plan({ actionId: "text-color", selection: "plain words", argument: "red" })
				?.markdownInsideHtml,
		).toBe(false);
	});

	it("stays quiet when the wrapper is being REMOVED", () => {
		const wrapped = text({ actionId: "text-color", selection: "**bold**", argument: "red" });
		expect(
			plan({ actionId: "text-color", selection: wrapped, argument: "red" })
				?.markdownInsideHtml,
		).toBe(false);
	});

	it("never fires for the actions that emit no HTML", () => {
		expect(plan({ actionId: "to-quote", selection: "**bold**" })?.markdownInsideHtml).toBe(false);
		expect(
			plan({ actionId: "wrap-callout", selection: "**bold**", argument: "tip" })
				?.markdownInsideHtml,
		).toBe(false);
	});
});

// -------------------------------------------------------------- alignment

describe("align", () => {
	it("wraps a block-level div on its own lines", () => {
		expect(text({ actionId: "align", selection: "centre me", argument: "center" })).toBe(
			'<div style="text-align: center;">\ncentre me\n</div>',
		);
	});

	it("left is the default, so it removes the wrapper instead of adding one", () => {
		const centred = text({ actionId: "align", selection: "x", argument: "center" });
		expect(text({ actionId: "align", selection: centred, argument: "left" })).toBe("x");
	});

	it("accepts German alignment names", () => {
		expect(text({ actionId: "align", selection: "x", argument: "zentriert" })).toBe(
			'<div style="text-align: center;">\nx\n</div>',
		);
		expect(text({ actionId: "align", selection: "x", argument: "blocksatz" })).toBe(
			'<div style="text-align: justify;">\nx\n</div>',
		);
	});

	it("refuses an unknown alignment", () => {
		expect(plan({ actionId: "align", selection: "x", argument: "sideways" })).toBeNull();
	});
});

// ---------------------------------------------------- line-prefix actions

describe("to-task / to-bullets / to-quote", () => {
	it("prefixes every line of a multi-line selection", () => {
		expect(text({ actionId: "to-task", selection: "one\ntwo\nthree" })).toBe(
			"- [ ] one\n- [ ] two\n- [ ] three",
		);
		expect(text({ actionId: "to-bullets", selection: "one\ntwo" })).toBe("- one\n- two");
		expect(text({ actionId: "to-quote", selection: "one\ntwo" })).toBe("> one\n> two");
	});

	it("converts rather than stacks: an existing marker is replaced", () => {
		expect(text({ actionId: "to-task", selection: "- one\n- two" })).toBe(
			"- [ ] one\n- [ ] two",
		);
		expect(text({ actionId: "to-bullets", selection: "1. one\n2. two" })).toBe("- one\n- two");
		expect(text({ actionId: "to-bullets", selection: "> quoted" })).toBe("- quoted");
		expect(text({ actionId: "to-task", selection: "> - nested" })).toBe("- [ ] nested");
	});

	it("toggles off when the selection already IS the target markup", () => {
		expect(text({ actionId: "to-task", selection: "- [ ] one\n- [x] two" })).toBe("one\ntwo");
		expect(text({ actionId: "to-bullets", selection: "- one\n- two" })).toBe("one\ntwo");
		expect(text({ actionId: "to-quote", selection: "> one\n> two" })).toBe("one\ntwo");
	});

	it("keeps indentation in front of the marker, so nesting survives", () => {
		expect(text({ actionId: "to-bullets", selection: "top\n\tnested" })).toBe("- top\n\t- nested");
	});

	it("drops blank lines from a list but keeps them inside a quote", () => {
		expect(text({ actionId: "to-bullets", selection: "one\n\ntwo" })).toBe("- one\n- two");
		// The arrow keeps the blockquote in one piece; the space is dropped so
		// the note does not gain trailing whitespace on every empty line.
		expect(text({ actionId: "to-quote", selection: "one\n\ntwo" })).toBe("> one\n>\n> two");
	});

	it("never loses a leading minus that is not a marker", () => {
		expect(text({ actionId: "to-bullets", selection: "-5 degrees" })).toBe("- -5 degrees");
	});

	it("puts the cursor at the end of the converted block", () => {
		const result = plan({ actionId: "to-task", selection: "one\ntwo" });
		expect(result?.cursor).toEqual({ lineDelta: 1, ch: "- [ ] two".length });
	});
});

describe("prefixSelection — the numbering rule wrap.ts uses", () => {
	it("counts an ordered prefix up, line by line", () => {
		expect(
			prefixSelection("a\nb\nc", {
				prefix: "1. ",
				present: /^[ \t]*\d+[.)]\s/,
				keepBlankLines: false,
			}),
		).toBe("1. a\n2. b\n3. c");
	});

	it("leaves a non-numbered prefix alone", () => {
		expect(
			prefixSelection("a\nb", { prefix: "- ", present: /^[ \t]*-\s/, keepBlankLines: false }),
		).toBe("- a\n- b");
	});

	it("survives an empty selection", () => {
		expect(
			prefixSelection("", { prefix: "- ", present: /^[ \t]*-\s/, keepBlankLines: false }),
		).toBe("- ");
	});
});

// ---------------------------------------------------------------- callout

describe("wrap-callout", () => {
	it("puts the selection inside the callout, every line quoted", () => {
		expect(text({ actionId: "wrap-callout", selection: "first\nsecond", argument: "warning" })).toBe(
			"> [!warning]\n> first\n> second",
		);
	});

	it("defaults to note when the picker was skipped", () => {
		expect(text({ actionId: "wrap-callout", selection: "x" })).toBe("> [!note]\n> x");
	});

	it("maps a synonym onto the real callout type", () => {
		expect(text({ actionId: "wrap-callout", selection: "x", argument: "Caution" })).toBe(
			"> [!warning]\n> x",
		);
		expect(text({ actionId: "wrap-callout", selection: "x", argument: "tldr" })).toBe(
			"> [!abstract]\n> x",
		);
	});

	it("passes an unknown but safe custom type through — Obsidian allows them", () => {
		expect(text({ actionId: "wrap-callout", selection: "x", argument: "recipe" })).toBe(
			"> [!recipe]\n> x",
		);
	});

	it("cannot be talked into breaking the syntax", () => {
		expect(text({ actionId: "wrap-callout", selection: "x", argument: "ev!l] type" })).toBe(
			"> [!evltype]\n> x",
		);
	});

	it("folds when asked", () => {
		expect(text({ actionId: "wrap-callout", selection: "x", argument: "tip", folded: true })).toBe(
			"> [!tip]-\n> x",
		);
	});

	it("does not nest a second blockquote inside the callout", () => {
		expect(text({ actionId: "wrap-callout", selection: "> quoted\n> lines" })).toBe(
			"> [!note]\n> quoted\n> lines",
		);
	});
});

// ------------------------------------------------------------------ dates

describe("insert-date", () => {
	it("uses the user's format", () => {
		expect(text({ actionId: "insert-date" })).toBe("2026-03-09");
		expect(
			text({ actionId: "insert-date", settings: { ...SETTINGS, dateFormat: "DD.MM.YYYY" } }),
		).toBe("09.03.2026");
	});

	it("is reachable through the block id too", () => {
		expect(text({ actionId: blockActionId("date") })).toBe("2026-03-09");
	});

	it("falls back to the default format rather than writing rubbish", () => {
		expect(text({ actionId: "insert-date", settings: { ...SETTINGS, dateFormat: "" } })).toBe(
			"2026-03-09",
		);
	});
});

// --------------------------------------------------------------- snippets

const SNIPPETS: readonly UserSnippet[] = [
	{ name: "Meeting", template: "## Meeting\n- Attendees: {cursor}\n- Notes:" },
	{ name: "Signature", template: "— Max" },
	{ name: "", template: "ignored, no name" },
	{ name: "No template", template: "" },
];

describe("snippets", () => {
	const settings: EditingSettings = { ...SETTINGS, snippets: SNIPPETS };

	it("becomes catalog entries, skipping the incomplete ones", () => {
		const blocks = snippetBlocks(SNIPPETS);
		expect(blocks.map((block) => block.name)).toEqual(["Meeting", "Signature"]);
		expect(blocks.map((block) => block.id)).toEqual(["snippet:meeting", "snippet:signature"]);
	});

	it("keys on the name, not the position, so reordering keeps the frecency", () => {
		const reordered = snippetBlocks([...SNIPPETS].reverse());
		expect(reordered.find((block) => block.name === "Meeting")?.id).toBe("snippet:meeting");
	});

	it("keeps colliding names apart", () => {
		const ids = snippetBlocks([
			{ name: "Same", template: "a" },
			{ name: "same", template: "b" },
		]).map((block) => block.id);
		expect(new Set(ids).size).toBe(2);
	});

	it("inserts by name", () => {
		const result = plan({ actionId: "insert-snippet", argument: "Meeting", settings });
		expect(result?.text).toBe("## Meeting\n- Attendees: \n- Notes:");
		expect(result?.cursor).toEqual({ lineDelta: 1, ch: "- Attendees: ".length });
	});

	it("inserts by block id", () => {
		expect(text({ actionId: blockActionId("snippet:signature"), settings })).toBe("— Max");
	});

	it("wraps the selection when the template marks a spot", () => {
		expect(
			text({
				actionId: "insert-snippet",
				argument: "Signature",
				selection: "regards",
				settings: {
					...settings,
					snippets: [{ name: "Signature", template: "**{cursor}**" }],
				},
			}),
		).toBe("**regards**");
	});

	it("refuses a snippet that is gone", () => {
		expect(plan({ actionId: "insert-snippet", argument: "Nope", settings })).toBeNull();
		expect(plan({ actionId: blockActionId("snippet:nope"), settings })).toBeNull();
	});
});

// ------------------------------------------------------- the other blocks

describe("insert blocks", () => {
	it("offers the date, the 13 callouts, a code block, a footnote and a rule", () => {
		const ids = INSERT_BLOCKS.map((block) => block.id);
		expect(ids).toContain("date");
		expect(ids).toContain("codeblock");
		expect(ids).toContain("footnote");
		expect(ids).toContain("horizontal-rule");
		expect(CALLOUT_TYPES).toHaveLength(13);
		for (const spec of CALLOUT_TYPES) expect(ids).toContain(`callout-${spec.type}`);
	});

	it("has a unique id per entry", () => {
		const ids = insertBlocks(SNIPPETS).map((block) => block.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("round-trips its action ids", () => {
		expect(blockIdFromActionId(blockActionId("codeblock"))).toBe("codeblock");
		expect(blockIdFromActionId("run")).toBeNull();
		expect(blockActionId("date").startsWith(INSERT_ACTION_PREFIX)).toBe(true);
	});

	it("resolves a block id back to its definition", () => {
		expect(findInsertBlock("callout-tip")?.template).toBe("> [!tip]{fold}\n> {cursor}");
		expect(findInsertBlock("nope")).toBeNull();
	});

	it("writes a callout from the catalog entry", () => {
		expect(text({ actionId: blockActionId("callout-danger"), selection: "run" })).toBe(
			"> [!danger]\n> run",
		);
	});

	it("writes a fenced code block with the language the picker collected", () => {
		expect(
			text({ actionId: blockActionId("codeblock"), selection: "let x = 1;", argument: "typescript" }),
		).toBe("```typescript\nlet x = 1;\n```\n");
		expect(text({ actionId: blockActionId("codeblock") })).toBe("```\n\n```");
	});

	it("sanitises a language before it reaches the fence", () => {
		expect(normalizeLanguage("C++")).toBe("c++");
		expect(normalizeLanguage("```evil")).toBe("evil");
		expect(normalizeLanguage("   ")).toBeNull();
		expect(CODE_LANGUAGES).toContain("typescript");
	});

	it("writes a horizontal rule", () => {
		expect(text({ actionId: blockActionId("horizontal-rule") })).toBe("\n---\n");
	});
});

// -------------------------------------------------------------- footnotes

describe("footnotes", () => {
	it("numbers from one in a document with none", () => {
		const result = planFootnote("Just some prose.");
		expect(result.text).toBe("[^1]");
		expect(result.appendToDocument).toBe("\n[^1]: ");
	});

	it("continues from the highest existing number", () => {
		const result = planFootnote("a[^1]\nb[^7]\n\n[^1]: one\n[^7]: seven\n");
		expect(result.text).toBe("[^8]");
		expect(result.appendToDocument).toBe("[^8]: ");
	});

	it("ignores named footnotes when numbering", () => {
		expect(planFootnote("see[^why]\n\n[^why]: because\n").text).toBe("[^1]");
	});

	it("is reachable through the catalog entry, but only with the document", () => {
		expect(plan({ actionId: blockActionId("footnote") })).toBeNull();
		expect(text({ actionId: blockActionId("footnote"), document: "text[^3]" })).toBe("[^4]");
	});

	it("never eats the sentence it annotates", () => {
		expect(
			text({
				actionId: blockActionId("footnote"),
				selection: "as Kahneman showed",
				document: "as Kahneman showed",
			}),
		).toBe("as Kahneman showed[^1]");
	});
});

// ---------------------------------------------------------------- parsing

describe("argument parsing", () => {
	it("accepts every palette colour", () => {
		for (const name of ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"]) {
			expect(parseColorName(name), name).toBe(name);
		}
		expect(parseColorName("RED")).toBe("red");
		expect(parseColorName(null)).toBeNull();
	});

	it("accepts every alignment", () => {
		for (const name of ["left", "center", "right", "justify"]) {
			expect(parseAlignment(name), name).toBe(name);
		}
		expect(parseAlignment("nowhere")).toBeNull();
	});

	it("normalises callout types", () => {
		expect(normalizeCalloutType("TIP")).toBe("tip");
		expect(normalizeCalloutType("tldr")).toBe("abstract");
		expect(normalizeCalloutType("")).toBe("note");
		expect(normalizeCalloutType(null)).toBe("note");
		expect(normalizeCalloutType("!!!")).toBe("note");
	});
});
