import { describe, expect, it } from "vitest";
import type { BlockDef, TemplateEnv } from "../src/core/blocks";
import { buildInsertion, resolveCursor } from "../src/core/insert";

function block(overrides: Partial<BlockDef> & { id: string }): BlockDef {
	return {
		name: overrides.id,
		aliases: [],
		group: "create",
		template: "{cursor}",
		wrap: "none",
		tile: { kind: "mono", sample: "{ }" },
		...overrides,
	};
}

const env = (overrides: Partial<TemplateEnv> = {}): TemplateEnv => ({
	selection: null,
	date: "2026-07-25",
	folded: false,
	language: null,
	...overrides,
});

const CODEBLOCK = block({ id: "codeblock", template: "```{lang}\n{cursor}\n```", wrap: "fenced" });
const CALLOUT = block({
	id: "callout-tip",
	template: "> [!tip]{fold}\n> {cursor}",
	wrap: "prefixLines",
	linePrefix: "> ",
});
const DATE = block({ id: "date", template: "{date}{cursor}" });

describe("resolveCursor", () => {
	it("places the cursor on a single line, as a delta from the insertion column", () => {
		expect(resolveCursor("# {cursor}")).toEqual({
			text: "# ",
			cursor: { lineDelta: 0, ch: 2 },
		});
	});

	it("places the cursor across lines, as an absolute column", () => {
		expect(resolveCursor("> [!note]\n> {cursor}")).toEqual({
			text: "> [!note]\n> ",
			cursor: { lineDelta: 1, ch: 2 },
		});
	});

	it("strips the sentinel from the text", () => {
		expect(resolveCursor("a{cursor}b").text).toBe("ab");
		expect(resolveCursor("a{cursor}b").cursor).toEqual({ lineDelta: 0, ch: 1 });
	});

	it("defaults to the very end when there is no sentinel", () => {
		expect(resolveCursor("abc\nde")).toEqual({
			text: "abc\nde",
			cursor: { lineDelta: 1, ch: 2 },
		});
		expect(resolveCursor("abcd")).toEqual({ text: "abcd", cursor: { lineDelta: 0, ch: 4 } });
		expect(resolveCursor("abc\n")).toEqual({ text: "abc\n", cursor: { lineDelta: 1, ch: 0 } });
	});

	it("handles an empty template", () => {
		expect(resolveCursor("")).toEqual({ text: "", cursor: { lineDelta: 0, ch: 0 } });
	});
});

describe("buildInsertion — placeholders", () => {
	it("substitutes {lang}, and empties it when there is no language", () => {
		expect(buildInsertion(CODEBLOCK, env({ language: "ts" })).text).toBe("```ts\n\n```");
		const bare = buildInsertion(CODEBLOCK, env());
		expect(bare.text).toBe("```\n\n```");
		expect(bare.cursor).toEqual({ lineDelta: 1, ch: 0 });
	});

	it("substitutes {fold} with the fold marker", () => {
		expect(buildInsertion(CALLOUT, env()).text).toBe("> [!tip]\n> ");
		expect(buildInsertion(CALLOUT, env({ folded: true })).text).toBe("> [!tip]-\n> ");
	});

	it("substitutes {date} with the injected date", () => {
		const plan = buildInsertion(DATE, env());
		expect(plan.text).toBe("2026-07-25");
		expect(plan.cursor).toEqual({ lineDelta: 0, ch: 10 });
	});

	it("leaves the template alone when the selection is empty or null", () => {
		expect(buildInsertion(CALLOUT, env({ selection: "" })).text).toBe("> [!tip]\n> ");
		expect(buildInsertion(CALLOUT, env({ selection: null })).text).toBe("> [!tip]\n> ");
	});
});

describe("buildInsertion — with a selection", () => {
	it("wraps a multi-line selection into a callout", () => {
		const plan = buildInsertion(CALLOUT, env({ selection: "first\nsecond" }));
		expect(plan.text).toBe("> [!tip]\n> first\n> second");
		expect(plan.cursor).toEqual({ lineDelta: 2, ch: 8 });
	});

	it("wraps a selection into a fenced code block, cursor below it", () => {
		const plan = buildInsertion(CODEBLOCK, env({ selection: "let x = 1;" }));
		expect(plan.text).toBe("```\nlet x = 1;\n```\n");
		expect(plan.cursor).toEqual({ lineDelta: 3, ch: 0 });
	});

	it("keeps the selection when the block accepts none", () => {
		const divider = block({ id: "divider", template: "---\n{cursor}", wrap: "none" });
		expect(buildInsertion(divider, env({ selection: "do not lose this" })).text).toBe(
			"do not lose this\n---\n",
		);
	});

	it("substitutes the placeholders before embedding the selection", () => {
		const plan = buildInsertion(CODEBLOCK, env({ selection: "x", language: "py" }));
		expect(plan.text).toBe("```py\nx\n```\n");
	});
});
