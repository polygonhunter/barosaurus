import { describe, expect, it } from "vitest";
import { createYielder } from "../src/core/budget";

describe("createYielder", () => {
	it("yields only once the time budget is used up", async () => {
		let clock = 0;
		let sleeps = 0;
		const maybeYield = createYielder({
			budgetMs: 12,
			now: () => clock,
			sleep: () => {
				sleeps += 1;
				return Promise.resolve();
			},
		});
		clock = 5;
		expect(await maybeYield()).toBe(false);
		clock = 11.9;
		expect(await maybeYield()).toBe(false);
		clock = 12;
		expect(await maybeYield()).toBe(true);
		// A fresh slice starts after the sleep.
		clock = 20;
		expect(await maybeYield()).toBe(false);
		clock = 30;
		expect(await maybeYield()).toBe(true);
		expect(sleeps).toBe(2);
	});

	it("measures the slice from after the sleep, not from before it", async () => {
		let clock = 0;
		const maybeYield = createYielder({
			budgetMs: 10,
			now: () => clock,
			sleep: () => {
				clock += 50; // the event loop was busy for a while
				return Promise.resolve();
			},
		});
		clock = 10;
		expect(await maybeYield()).toBe(true); // clock is now 60
		clock = 65;
		expect(await maybeYield()).toBe(false);
	});
});
