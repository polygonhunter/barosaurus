/**
 * The page stack behind the breadcrumb pills.
 *
 * "Move to…" pushes a folder picker, a colour action pushes a swatch picker,
 * and each level keeps its own query so backing out of a picker returns you
 * to the text you had typed, not to an empty field.
 *
 * Pure state machine: the modal owns the Scope objects and the DOM, this owns
 * the truth about where you are.
 */

export interface Page {
	/** Discriminates what the level shows; the modal switches on it. */
	kind: string;
	/** Breadcrumb label, sentence case. */
	label: string;
	/** The query typed at this level, preserved across push/pop. */
	query: string;
	/** Value collected at this level, once chosen. */
	value?: string;
}

export interface PageStackState {
	/** Always at least one entry: the root. */
	pages: Page[];
}

export const ROOT_PAGE: Page = { kind: "root", label: "", query: "" };

export function createStack(): PageStackState {
	return { pages: [{ ...ROOT_PAGE }] };
}

export function depth(state: PageStackState): number {
	return state.pages.length - 1;
}

export function current(state: PageStackState): Page {
	// The root guarantees this is never undefined; the fallback keeps the
	// compiler honest under noUncheckedIndexedAccess.
	return state.pages[state.pages.length - 1] ?? { ...ROOT_PAGE };
}

export function push(state: PageStackState, page: Omit<Page, "query">): PageStackState {
	return { pages: [...state.pages, { ...page, query: "" }] };
}

/**
 * Pop one level. Returns the SAME state at the root — the caller reads that
 * as "nothing left to pop, close instead". Making close a caller decision
 * keeps Esc-closes-at-root and Backspace-never-closes in one place.
 */
export function pop(state: PageStackState): PageStackState {
	if (state.pages.length <= 1) return state;
	return { pages: state.pages.slice(0, -1) };
}

export function isRoot(state: PageStackState): boolean {
	return state.pages.length <= 1;
}

/** Record what was typed at the current level. */
export function setQuery(state: PageStackState, query: string): PageStackState {
	const pages = [...state.pages];
	const last = pages[pages.length - 1];
	if (last) pages[pages.length - 1] = { ...last, query };
	return { pages };
}

/** Record the value chosen at the current level (shown in the pill). */
export function setValue(state: PageStackState, value: string): PageStackState {
	const pages = [...state.pages];
	const last = pages[pages.length - 1];
	if (last) pages[pages.length - 1] = { ...last, value };
	return { pages };
}

/** Breadcrumb pills, root excluded — the root has no pill. */
export function breadcrumbs(state: PageStackState): Page[] {
	return state.pages.slice(1);
}

/** Values collected so far, in push order — the arguments an action receives. */
export function collectedValues(state: PageStackState): string[] {
	return state.pages
		.slice(1)
		.map((page) => page.value)
		.filter((value): value is string => value !== undefined);
}

/**
 * What Esc and Backspace-on-empty-input do. Both pop, and neither closes
 * anywhere but the root — the classic mistake is letting Backspace close the
 * whole bar because the input happened to be empty two levels deep.
 */
export function resolveBack(state: PageStackState): { action: "pop" | "close" } {
	return isRoot(state) ? { action: "close" } : { action: "pop" };
}
