/**
 * Cooperative yielding by TIME, not by item count.
 *
 * The indexer and the OCR sweep used to yield every 20 files. Twenty tiny
 * notes take a fraction of a millisecond, so that yielded far too often on a
 * fast machine; twenty large ones can take 100 ms, which is a visible stall on
 * a phone. A frame budget is what both loops actually meant.
 *
 * Pure and injectable: the clock and the sleep come from the caller, so this
 * file needs neither obsidian nor a window, and the test drives a fake clock.
 */

/** About three quarters of a 60 Hz frame — leaves room for the UI's own work. */
export const DEFAULT_BUDGET_MS = 12;

export interface YielderOptions {
	/** Work allowed between two yields. */
	budgetMs?: number;
	/** Monotonic clock in ms. */
	now: () => number;
	/** Give the event loop a turn — production passes `setTimeout(0)`. */
	sleep: () => Promise<void>;
}

/**
 * Returns `maybeYield`: call it after each unit of work. It sleeps once the
 * budget since the last yield is used up and resolves to whether it did.
 */
export function createYielder(options: YielderOptions): () => Promise<boolean> {
	const budget = options.budgetMs ?? DEFAULT_BUDGET_MS;
	let sliceStart = options.now();
	return async () => {
		if (options.now() - sliceStart < budget) return false;
		await options.sleep();
		sliceStart = options.now();
		return true;
	};
}
