import { describe, expect, it } from "vitest";
import type { WrapKind } from "../src/core/blocks";
import { embedSelection } from "../src/core/wrap";

const SELECTION = "do not lose me";

const CASES: Array<{ kind: WrapKind; template: string; linePrefix: string }> = [
	{ kind: "inline", template: "[[{cursor}]]", linePrefix: "" },
	{ kind: "prefixLines", template: "> {cursor}", linePrefix: "> " },
	{ kind: "fenced", template: "```\n{cursor}\n```", linePrefix: "" },
	{ kind: "none", template: "---\n{cursor}", linePrefix: "" },
];

describe("embedSelection", () => {
	it("inline: the selection lands inside, the cursor right behind it", () => {
		expect(embedSelection("[[{cursor}]]", "My note", "inline", "")).toBe("[[My note{cursor}]]");
		expect(embedSelection("**{cursor}**", "bold me", "inline", "")).toBe("**bold me{cursor}**");
	});

	it("prefixLines: later lines get the prefix, the first reuses the template's", () => {
		expect(embedSelection("> {cursor}", "one\ntwo", "prefixLines", "> ")).toBe(
			"> one\n> two{cursor}",
		);
	});

	it("prefixLines: a numbered prefix counts up", () => {
		expect(embedSelection("1. {cursor}", "a\nb\nc", "prefixLines", "1. ")).toBe(
			"1. a\n2. b\n3. c{cursor}",
		);
		expect(embedSelection("1) {cursor}", "a\nb", "prefixLines", "1) ")).toBe("1) a\n2) b{cursor}");
	});

	it("prefixLines: a non-numbered prefix passes through unchanged", () => {
		expect(embedSelection("> {cursor}", "a\nb\nc", "prefixLines", "> ")).toBe(
			"> a\n> b\n> c{cursor}",
		);
		expect(embedSelection("- {cursor}", "a\nb", "prefixLines", "- ")).toBe("- a\n- b{cursor}");
	});

	it("prefixLines: a single-line selection needs no extra prefix", () => {
		expect(embedSelection("1. {cursor}", "only", "prefixLines", "1. ")).toBe("1. only{cursor}");
	});

	it("fenced: the selection fills the block, the cursor continues below", () => {
		expect(embedSelection("```\n{cursor}\n```", "x = 1", "fenced", "")).toBe(
			"```\nx = 1\n```\n{cursor}",
		);
	});

	it("none: the selection is re-emitted above the block", () => {
		expect(embedSelection("---\n{cursor}", "keep me", "none", "")).toBe("keep me\n---\n{cursor}");
	});

	for (const { kind, template, linePrefix } of CASES) {
		it(`never drops the selection or the cursor for wrap kind "${kind}"`, () => {
			const result = embedSelection(template, SELECTION, kind, linePrefix);
			expect(result, kind).toContain(SELECTION);
			expect(result.split("{cursor}"), `${kind} keeps exactly one cursor`).toHaveLength(2);
		});
	}

	for (const { kind, template, linePrefix } of CASES) {
		it(`keeps every line of a multi-line selection for wrap kind "${kind}"`, () => {
			const result = embedSelection(template, "alpha\nbeta\ngamma", kind, linePrefix);
			for (const line of ["alpha", "beta", "gamma"]) {
				expect(result, `${kind} keeps ${line}`).toContain(line);
			}
		});
	}
});
