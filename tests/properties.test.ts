import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { parseQuery } from "../src/core/query";
import { EMPTY_CONTEXT, type BarContext } from "../src/core/types";
import {
	parsePropertyAction,
	propertiesSource,
	REMOVE_PROPERTY_PREFIX,
	SET_PROPERTY_PREFIX,
} from "../src/sources/properties";
import type { SourceContext } from "../src/sources/source";

/**
 * Properties of the note you are in.
 *
 * The point of this source is that it needs no target: every other action in
 * the bar acts on a result you had to find first, and having to search for the
 * note you are looking at in order to set its author is the long way round.
 * So the two things worth pinning down are that it only fires with a note open,
 * and that the row carries that note's path all the way to the executor.
 */

function ctxWith(query: string, activeFile: string | null, limit = 20): SourceContext {
	const bar: BarContext = { ...EMPTY_CONTEXT, activeFile };
	return {
		app: {} as unknown as App,
		bar,
		query: parseQuery(query),
		limit,
	};
}

const NOTE = "Projects/Q3 report.md";

describe("propertiesSource applies", () => {
	it("only when a note is open", () => {
		expect(propertiesSource.appliesTo(ctxWith("author", NOTE))).toBe(true);
		expect(propertiesSource.appliesTo(ctxWith("author", null))).toBe(false);
	});

	it("not on an empty query — the empty bar is the launcher", () => {
		expect(propertiesSource.appliesTo(ctxWith("", NOTE))).toBe(false);
	});

	it("not under a sigil that means something else", () => {
		// ">" wants commands, "@" the outline, ":42" a line.
		expect(propertiesSource.appliesTo(ctxWith(">author", NOTE))).toBe(false);
		expect(propertiesSource.appliesTo(ctxWith("@author", NOTE))).toBe(false);
	});
});

describe("the rows it offers", () => {
	function titles(query: string, activeFile: string | null = NOTE): string[] {
		return propertiesSource
			.getCandidates(ctxWith(query, activeFile))
			.map((candidate) => candidate.item.title);
	}

	it("names a common property directly", () => {
		expect(titles("author")).toContain("Set author…");
	});

	it("matches on a prefix, so two letters are enough", () => {
		expect(titles("au")).toContain("Set author…");
		expect(titles("stat")).toContain("Set status…");
	});

	it("offers the generic row for anything the shortlist misses", () => {
		expect(titles("property")).toContain("Set property…");
		expect(titles("frontmatter")).toContain("Set property…");
	});

	it("offers removal too, but not on a single letter", () => {
		expect(titles("remove prop")).toContain("Remove property…");
		expect(titles("r")).not.toContain("Remove property…");
	});

	it("puts every row in the actions group, which sorts first", () => {
		const items = propertiesSource.getCandidates(ctxWith("author", NOTE));
		expect(items.length).toBeGreaterThan(0);
		for (const { item } of items) expect(item.group).toBe("actions");
	});

	it("names the note it will write to", () => {
		const [first] = propertiesSource.getCandidates(ctxWith("author", NOTE));
		expect(first?.item.subtitle).toBe("Q3 report.md");
	});

	it("respects the limit it is given", () => {
		expect(propertiesSource.getCandidates(ctxWith("a", NOTE, 1)).length).toBeLessThanOrEqual(1);
	});
});

/**
 * The row is a `kind: "action"`, which carries no path of its own, so the target
 * travels inside the id — the same trick GOTO_LINE_PREFIX uses. If this parse
 * ever disagrees with what the source mints, the flow writes to the wrong note
 * or to none, so the two are checked against each other rather than in isolation.
 */
describe("the id carries the target", () => {
	it("round-trips what the source actually emits", () => {
		for (const { item } of propertiesSource.getCandidates(ctxWith("author", NOTE))) {
			if (item.kind !== "action") throw new Error("expected an action row");
			const parsed = parsePropertyAction(item.actionId);
			expect(parsed).not.toBeNull();
			expect(parsed?.path).toBe(NOTE);
		}
	});

	it("separates the set and remove verbs", () => {
		expect(parsePropertyAction(`${SET_PROPERTY_PREFIX}${NOTE}`)?.action).toBe("set-property");
		expect(parsePropertyAction(`${REMOVE_PROPERTY_PREFIX}${NOTE}`)?.action).toBe("remove-property");
	});

	it("reports the named key so the flow can skip that page", () => {
		expect(parsePropertyAction(`${SET_PROPERTY_PREFIX}${NOTE}\u0000author`)?.key).toBe("author");
		expect(parsePropertyAction(`${SET_PROPERTY_PREFIX}${NOTE}`)?.key).toBeNull();
	});

	// The separator has to survive a path with a space in it, which is most of
	// them. A space separator parses "Projects/Q3 report.md" down to
	// "Projects/Q3" and the write lands on a note that does not exist.
	it("keeps a path that contains spaces intact", () => {
		const parsed = parsePropertyAction(`${SET_PROPERTY_PREFIX}${NOTE}\u0000author`);
		expect(parsed?.path).toBe(NOTE);
		expect(NOTE).toContain(" ");
	});

	it("declines anything that is not one of its ids", () => {
		expect(parsePropertyAction("goto-line:42")).toBeNull();
		expect(parsePropertyAction("set-property")).toBeNull();
		expect(parsePropertyAction(SET_PROPERTY_PREFIX)).toBeNull();
	});
});
