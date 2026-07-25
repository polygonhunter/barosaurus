import { describe, expect, it } from "vitest";
import { pushHistory } from "../src/core/history";

describe("pushHistory", () => {
	it("prepends new queries, newest first", () => {
		expect(pushHistory(["b"], "a")).toEqual(["a", "b"]);
		expect(pushHistory([], "a")).toEqual(["a"]);
	});

	it("trims the stored value", () => {
		expect(pushHistory([], "  bold  ")).toEqual(["bold"]);
	});

	it("dedupes on the trimmed value, moving the repeat to the front", () => {
		expect(pushHistory(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
		expect(pushHistory(["bold", "x"], "  bold  ")).toEqual(["bold", "x"]);
	});

	it("dedupes EXACTLY — a different casing is a different query", () => {
		expect(pushHistory(["Bold"], "bold")).toEqual(["bold", "Bold"]);
	});

	it("returns a copy for a whitespace-only query, and never mutates", () => {
		const history = ["a", "b"];
		const next = pushHistory(history, "   ");
		expect(next).toEqual(["a", "b"]);
		expect(next).not.toBe(history);
		expect(pushHistory(history, "")).not.toBe(history);
	});

	it("leaves the input array untouched", () => {
		const history = ["a", "b"];
		pushHistory(history, "b");
		expect(history).toEqual(["a", "b"]);
	});

	it("caps at 50 entries", () => {
		const full = Array.from({ length: 50 }, (_, i) => `q${i}`);
		const next = pushHistory(full, "new");
		expect(next).toHaveLength(50);
		expect(next[0]).toBe("new");
		expect(next).not.toContain("q49");
	});
});
