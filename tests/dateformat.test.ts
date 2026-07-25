import { describe, expect, it } from "vitest";
import { DEFAULT_DATE_FORMAT, formatDate, formatWithPattern } from "../src/core/dateformat";

/**
 * Local time throughout: the formatter reads getFullYear/getMonth/… so a Date
 * built from local components is what the user's editor will see. Constructing
 * with `new Date(2026, 2, 9, …)` avoids the UTC-vs-local trap that makes a
 * timezone-sensitive test pass in Berlin and fail in CI.
 */
const SPRING = new Date(2026, 2, 9, 8, 5, 4); // Monday, 9 March 2026, 08:05:04
const EVENING = new Date(2026, 11, 24, 18, 30, 0); // Thursday, 24 December 2026

describe("formatDate — the tokens the settings tab promises", () => {
	it("YYYY, MM and DD", () => {
		expect(formatDate(SPRING, "YYYY-MM-DD")).toBe("2026-03-09");
		expect(formatDate(EVENING, "YYYY-MM-DD")).toBe("2026-12-24");
	});

	it("HH and mm", () => {
		expect(formatDate(SPRING, "HH:mm")).toBe("08:05");
		expect(formatDate(EVENING, "HH:mm")).toBe("18:30");
	});

	it("combines date and time", () => {
		expect(formatDate(SPRING, "YYYY-MM-DD HH:mm")).toBe("2026-03-09 08:05");
	});
});

describe("formatDate — the rest", () => {
	it("two-digit year", () => {
		expect(formatDate(SPRING, "YY")).toBe("26");
		expect(formatDate(new Date(2007, 0, 1), "YY")).toBe("07");
	});

	it("month names, long and short", () => {
		expect(formatDate(SPRING, "MMMM")).toBe("March");
		expect(formatDate(SPRING, "MMM")).toBe("Mar");
	});

	it("weekday names, long and short", () => {
		expect(formatDate(SPRING, "dddd")).toBe("Monday");
		expect(formatDate(SPRING, "ddd")).toBe("Mon");
	});

	it("unpadded month and day", () => {
		expect(formatDate(SPRING, "D.M.YYYY")).toBe("9.3.2026");
	});

	it("12-hour clock with a meridiem", () => {
		expect(formatDate(SPRING, "h:mm a")).toBe("8:05 am");
		expect(formatDate(EVENING, "h:mm A")).toBe("6:30 PM");
		expect(formatDate(new Date(2026, 0, 1, 0, 15), "hh:mm A")).toBe("12:15 AM");
		expect(formatDate(new Date(2026, 0, 1, 12, 15), "hh:mm A")).toBe("12:15 PM");
	});

	it("seconds", () => {
		expect(formatDate(SPRING, "ss")).toBe("04");
		expect(formatDate(SPRING, "s")).toBe("4");
	});
});

describe("formatDate — the traps", () => {
	it("prefers the longest token: YYYY is not two YY", () => {
		expect(formatDate(SPRING, "YYYY")).toBe("2026");
		expect(formatDate(SPRING, "MMMM")).toBe("March");
	});

	it("leaves bracketed literals alone, tokens and all", () => {
		expect(formatDate(SPRING, "[Week of ]YYYY")).toBe("Week of 2026");
		expect(formatDate(SPRING, "[YYYY]")).toBe("YYYY");
	});

	it("passes unrecognised characters straight through", () => {
		expect(formatDate(SPRING, "YYYY/MM/DD — note")).toBe("2026/03/09 — note");
	});

	it("returns an empty string for an unusable date rather than NaN", () => {
		expect(formatDate(new Date("nonsense"), "YYYY-MM-DD")).toBe("");
	});

	// The whole reason this module exists: no moment, ever.
	it("needs no locale and no external library", () => {
		expect(formatDate(SPRING, DEFAULT_DATE_FORMAT)).toBe("2026-03-09");
	});
});

describe("formatWithPattern", () => {
	it("uses the user's pattern", () => {
		expect(formatWithPattern(SPRING, "DD.MM.YYYY")).toBe("09.03.2026");
	});

	it("trims the pattern before using it", () => {
		expect(formatWithPattern(SPRING, "  YYYY-MM-DD  ")).toBe("2026-03-09");
	});

	it("falls back to the default when the pattern is blank", () => {
		expect(formatWithPattern(SPRING, "")).toBe("2026-03-09");
		expect(formatWithPattern(SPRING, "   ")).toBe("2026-03-09");
	});

	it("falls back when the pattern renders to a constant — always a typo", () => {
		expect(formatWithPattern(SPRING, "-")).toBe("2026-03-09");
	});

	it("keeps a deliberate literal-only pattern", () => {
		expect(formatWithPattern(SPRING, "[today]")).toBe("today");
	});
});
