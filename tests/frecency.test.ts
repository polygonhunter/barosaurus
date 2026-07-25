import { describe, expect, it } from "vitest";
import {
	bumpFrecency,
	frecencyBoost,
	frecencyScore,
	HALF_LIFE_COMMANDS_MS,
	HALF_LIFE_FILES_MS,
	pruneFrecency,
	renameFrecency,
	topFrecent,
	type FrecencyEntry,
} from "../src/core/frecency";

const DAY = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 400;

describe("bumpFrecency", () => {
	it("creates an entry on first use", () => {
		const map: Record<string, FrecencyEntry> = {};
		bumpFrecency(map, "a.md", 1000);
		expect(map["a.md"]).toEqual({ count: 1, last: 1000 });
	});

	it("counts up and moves the timestamp forward", () => {
		const map: Record<string, FrecencyEntry> = {};
		bumpFrecency(map, "a.md", 1000);
		bumpFrecency(map, "a.md", 2000);
		expect(map["a.md"]).toEqual({ count: 2, last: 2000 });
	});

	it("mutates the entry in place rather than replacing it", () => {
		const map: Record<string, FrecencyEntry> = { "a.md": { count: 1, last: 0 } };
		const entry = map["a.md"];
		bumpFrecency(map, "a.md", 500);
		expect(map["a.md"]).toBe(entry);
		expect(entry).toEqual({ count: 2, last: 500 });
	});

	it("caps the count so a hammered command cannot run away", () => {
		const map: Record<string, FrecencyEntry> = {};
		for (let i = 0; i < 1005; i++) bumpFrecency(map, "spam", i);
		expect(map["spam"]?.count).toBe(1000);
		expect(map["spam"]?.last).toBe(1004);
	});
});

describe("frecencyScore — half-life decay", () => {
	it("is the raw count at the moment of use", () => {
		expect(frecencyScore({ count: 8, last: 0 }, 0)).toBe(8);
	});

	it("halves after exactly one file half-life", () => {
		const entry: FrecencyEntry = { count: 8, last: 0 };
		expect(frecencyScore(entry, HALF_LIFE_FILES_MS)).toBeCloseTo(4);
		expect(frecencyScore(entry, 2 * HALF_LIFE_FILES_MS)).toBeCloseTo(2);
		expect(HALF_LIFE_FILES_MS).toBe(14 * DAY);
	});

	it("decays commands faster than files at the same elapsed time", () => {
		const entry: FrecencyEntry = { count: 8, last: 0 };
		const elapsed = 5 * DAY;
		expect(HALF_LIFE_COMMANDS_MS).toBeLessThan(HALF_LIFE_FILES_MS);
		expect(frecencyScore(entry, elapsed, HALF_LIFE_COMMANDS_MS)).toBeCloseTo(4);
		expect(frecencyScore(entry, elapsed, HALF_LIFE_COMMANDS_MS)).toBeLessThan(
			frecencyScore(entry, elapsed, HALF_LIFE_FILES_MS),
		);
	});

	it("never scores a future timestamp above the raw count", () => {
		// Clock-skew guard: a backwards jump must not inflate anything.
		const entry: FrecencyEntry = { count: 6, last: 10 * DAY };
		expect(frecencyScore(entry, 0)).toBe(6);
		expect(frecencyScore(entry, 0)).toBeLessThanOrEqual(entry.count);
		expect(frecencyScore(entry, 5 * DAY)).toBe(6);
	});

	it("ranks frequent-and-recent above merely frequent", () => {
		const now = 100 * DAY;
		const map: Record<string, FrecencyEntry> = {
			"old-favourite.md": { count: 50, last: now - 90 * DAY },
			"current-project.md": { count: 10, last: now - DAY },
		};
		expect(topFrecent(map, now, 2)[0]).toBe("current-project.md");
	});
});

describe("frecencyBoost — bounded, saturating bonus", () => {
	it("is 0 for an entry that does not exist", () => {
		expect(frecencyBoost(undefined, 0)).toBe(0);
	});

	it("stays below 1 even for a maxed-out count", () => {
		const boost = frecencyBoost({ count: 1000, last: 0 }, 0);
		expect(boost).toBeLessThan(1);
		expect(boost).toBeGreaterThan(0.99);
	});

	it("is monotonic in the count", () => {
		const counts = [1, 2, 5, 20, 100, 1000];
		let previous = 0;
		for (const count of counts) {
			const boost = frecencyBoost({ count, last: 0 }, 0);
			expect(boost, `count ${count} rises`).toBeGreaterThan(previous);
			previous = boost;
		}
	});

	it("shrinks as the entry ages", () => {
		const entry: FrecencyEntry = { count: 10, last: 0 };
		expect(frecencyBoost(entry, 4 * HALF_LIFE_FILES_MS)).toBeLessThan(frecencyBoost(entry, 0));
	});
});

describe("topFrecent", () => {
	it("respects the limit", () => {
		const map: Record<string, FrecencyEntry> = {
			"a.md": { count: 3, last: 0 },
			"b.md": { count: 2, last: 0 },
			"c.md": { count: 1, last: 0 },
		};
		expect(topFrecent(map, 0, 2)).toEqual(["a.md", "b.md"]);
	});

	it("excludes given keys (pins are listed separately)", () => {
		const map: Record<string, FrecencyEntry> = {
			"a.md": { count: 5, last: 0 },
			"b.md": { count: 1, last: 0 },
		};
		expect(topFrecent(map, 0, 5, new Set(["a.md"]))).toEqual(["b.md"]);
	});

	it("is deterministic for equal scores", () => {
		const map: Record<string, FrecencyEntry> = {
			"c.md": { count: 1, last: 0 },
			"a.md": { count: 1, last: 0 },
			"b.md": { count: 1, last: 0 },
		};
		expect(topFrecent(map, 0, 3)).toEqual(["a.md", "b.md", "c.md"]);
		expect(topFrecent(map, 0, 3)).toEqual(topFrecent(map, 0, 3));
	});

	it("honours a shorter half-life", () => {
		const map: Record<string, FrecencyEntry> = {
			"burst.md": { count: 20, last: -10 * DAY },
			"steady.md": { count: 8, last: 0 },
		};
		expect(topFrecent(map, 0, 1, new Set(), HALF_LIFE_COMMANDS_MS)).toEqual(["steady.md"]);
		expect(topFrecent(map, 0, 1, new Set(), HALF_LIFE_FILES_MS)).toEqual(["burst.md"]);
	});

	it("returns nothing for an empty map", () => {
		expect(topFrecent({}, 0, 5)).toEqual([]);
	});
});

describe("pruneFrecency", () => {
	it("is a no-op at or under the cap", () => {
		const map: Record<string, FrecencyEntry> = {};
		for (let i = 0; i < MAX_ENTRIES; i++) map[`note-${i}.md`] = { count: i + 1, last: 0 };
		pruneFrecency(map, 0);
		expect(Object.keys(map)).toHaveLength(MAX_ENTRIES);
		expect(map["note-0.md"]).toEqual({ count: 1, last: 0 });
	});

	it("keeps the highest scorers past the cap", () => {
		const map: Record<string, FrecencyEntry> = {};
		for (let i = 0; i < 450; i++) map[`note-${i}.md`] = { count: i + 1, last: 0 };
		pruneFrecency(map, 0);
		expect(Object.keys(map)).toHaveLength(MAX_ENTRIES);
		expect(map["note-449.md"]).toBeDefined();
		expect(map["note-0.md"]).toBeUndefined();
	});

	it("scores by recency too, not by raw count", () => {
		const map: Record<string, FrecencyEntry> = {};
		for (let i = 0; i < MAX_ENTRIES; i++) map[`note-${i}.md`] = { count: 5, last: 0 };
		map["ancient.md"] = { count: 6, last: -400 * DAY };
		pruneFrecency(map, 0);
		expect(Object.keys(map)).toHaveLength(MAX_ENTRIES);
		expect(map["ancient.md"]).toBeUndefined();
	});
});

describe("renameFrecency", () => {
	it("carries the history across a rename", () => {
		const map: Record<string, FrecencyEntry> = { "old.md": { count: 3, last: 7 } };
		renameFrecency(map, "old.md", "new.md");
		expect(map["new.md"]).toEqual({ count: 3, last: 7 });
		expect(map["old.md"]).toBeUndefined();
	});

	it("does nothing for an unknown key", () => {
		const map: Record<string, FrecencyEntry> = { "a.md": { count: 1, last: 0 } };
		renameFrecency(map, "missing.md", "new.md");
		expect(map).toEqual({ "a.md": { count: 1, last: 0 } });
		expect(map["new.md"]).toBeUndefined();
	});
});
