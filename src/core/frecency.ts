/**
 * Frecency (frequency + recency): things you use often and recently float up.
 * Pure math — the plugin feeds use events in and asks for the top list.
 *
 * Barosaurus differs from the usual launcher in one way that matters: frecency
 * does not only order the EMPTY state, it also feeds the score while you type
 * (see rank.ts). So the decay constant is a parameter here rather than a
 * module private — commands are used in bursts and should fade faster than
 * notes, which stay relevant for weeks.
 */

export interface FrecencyEntry {
	/** How often the entry was used (capped). */
	count: number;
	/** Last use, epoch ms. */
	last: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Notes stay relevant for weeks. */
export const HALF_LIFE_FILES_MS = 14 * DAY_MS;

/** Commands are used in bursts; last week's burst should not dominate today. */
export const HALF_LIFE_COMMANDS_MS = 5 * DAY_MS;

const MAX_COUNT = 1000;
const MAX_ENTRIES = 400;

export function bumpFrecency(map: Record<string, FrecencyEntry>, key: string, now: number): void {
	const entry = map[key];
	if (entry) {
		entry.count = Math.min(entry.count + 1, MAX_COUNT);
		entry.last = now;
	} else {
		map[key] = { count: 1, last: now };
	}
}

/** Count decayed by elapsed half-lives — old favourites fade, never snap. */
export function frecencyScore(
	entry: FrecencyEntry,
	now: number,
	halfLifeMs: number = HALF_LIFE_FILES_MS,
): number {
	// max(0, …) guards a clock that jumped backwards: a future timestamp must
	// never score above the raw count.
	return entry.count * Math.pow(0.5, Math.max(0, now - entry.last) / halfLifeMs);
}

/**
 * Frecency as a bounded ranking bonus rather than a raw count, so it can be
 * added to a normalized [0,1] match score without swamping it. Saturates:
 * the difference between "used 40 times" and "used 400 times" is negligible,
 * but the difference between "never" and "twice" is not.
 */
export function frecencyBoost(
	entry: FrecencyEntry | undefined,
	now: number,
	halfLifeMs: number = HALF_LIFE_FILES_MS,
): number {
	if (!entry) return 0;
	const score = frecencyScore(entry, now, halfLifeMs);
	return score / (score + 3);
}

export function topFrecent(
	map: Record<string, FrecencyEntry>,
	now: number,
	limit: number,
	exclude: ReadonlySet<string> = new Set(),
	halfLifeMs: number = HALF_LIFE_FILES_MS,
): string[] {
	return Object.entries(map)
		.filter(([key]) => !exclude.has(key))
		.map(([key, entry]) => [key, frecencyScore(entry, now, halfLifeMs)] as const)
		.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
		.slice(0, limit)
		.map(([key]) => key);
}

/** Keep the map bounded; drop the lowest-scoring tail. */
export function pruneFrecency(
	map: Record<string, FrecencyEntry>,
	now: number,
	halfLifeMs: number = HALF_LIFE_FILES_MS,
): void {
	const entries = Object.entries(map);
	if (entries.length <= MAX_ENTRIES) return;
	entries.sort(
		(a, b) => frecencyScore(b[1], now, halfLifeMs) - frecencyScore(a[1], now, halfLifeMs),
	);
	for (const [key] of entries.slice(MAX_ENTRIES)) delete map[key];
}

/** A rename keeps the file's history. */
export function renameFrecency(
	map: Record<string, FrecencyEntry>,
	oldKey: string,
	newKey: string,
): void {
	const entry = map[oldKey];
	if (!entry) return;
	delete map[oldKey];
	map[newKey] = entry;
}
