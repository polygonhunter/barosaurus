import {
	GROUP_LABELS,
	GROUP_ORDER,
	type GroupHeader,
	type GroupId,
	type OmniItem,
	type OmniRow,
} from "./types";

/**
 * Ranked items → the row list the modal actually renders.
 *
 * Two things make this worth its own pure module.
 *
 * 1. A group with no items must leave NO trace — no overline, no gap. Building
 *    headers up front and filtering afterwards is how you end up with a
 *    dangling "Bookmarks" label above the next group's rows, so headers are
 *    only emitted once a group is known to be non-empty.
 * 2. The limit arithmetic. Barosaurus renders group headers as list entries,
 *    so SuggestModal counts them: `limit` must be the TOTAL row count,
 *    synthetic rows included. Searchosaurus appends ghost rows *after*
 *    slicing to the item limit and SuggestModal quietly truncates them away
 *    again — with headers in the list that same bug deletes whole groups, so
 *    the count is computed here, next to the rows it describes, and handed
 *    back as `limit` rather than recomputed by the caller.
 */

export interface GroupingOptions {
	/** Display order; groups missing from it are dropped. Default GROUP_ORDER. */
	order?: readonly GroupId[];
	/** Overline copy. Default GROUP_LABELS. */
	labels?: Readonly<Record<GroupId, string>>;
	/** Max item rows per group. Default: unlimited. */
	perGroupLimit?: number;
	/** Max item rows overall; headers never count against it. Default: unlimited. */
	maxItems?: number;
	/** Emit overlines at all — a scoped query showing one group needs none. */
	headers?: boolean;
}

export interface GroupedRows {
	/** Headers and items interleaved, in render order. */
	rows: OmniRow[];
	/**
	 * `rows.length`. Exactly what `SuggestModal.limit` must be set to: every
	 * synthetic row (header, create-from-query, ghost) occupies a slot.
	 */
	limit: number;
	/** Item rows only — `rows.length` minus the headers. */
	itemCount: number;
	/** The item rows in row order; index n is what ⌘(n+1) picks. */
	items: OmniItem[];
}

/** A fresh empty result — never a shared constant, callers mutate `rows`. */
export function emptyRows(): GroupedRows {
	return { rows: [], limit: 0, itemCount: 0, items: [] };
}

export function headerFor(
	group: GroupId,
	labels: Readonly<Record<GroupId, string>> = GROUP_LABELS,
): GroupHeader {
	return { kind: "group-header", group, label: labels[group] };
}

/**
 * Bucket already-ranked items by group and interleave the overlines.
 *
 * Input order is preserved inside a group, because the ranker has already
 * decided it; only the groups themselves are re-ordered, by `order`.
 */
export function groupRows(
	items: readonly OmniItem[],
	options: GroupingOptions = {},
): GroupedRows {
	const order = options.order ?? GROUP_ORDER;
	const labels = options.labels ?? GROUP_LABELS;
	const perGroupLimit = options.perGroupLimit ?? Number.POSITIVE_INFINITY;
	const withHeaders = options.headers ?? true;
	let budget = options.maxItems ?? Number.POSITIVE_INFINITY;

	const buckets = new Map<GroupId, OmniItem[]>();
	for (const item of items) {
		const bucket = buckets.get(item.group);
		if (bucket) bucket.push(item);
		else buckets.set(item.group, [item]);
	}

	const rows: OmniRow[] = [];
	const flat: OmniItem[] = [];
	for (const group of order) {
		if (budget <= 0) break;
		const bucket = buckets.get(group);
		// An empty group disappears together with its label — the header is
		// only created once we know at least one item survives the caps.
		if (bucket === undefined || bucket.length === 0) continue;
		const take = bucket.slice(0, Math.min(perGroupLimit, budget));
		if (take.length === 0) continue;
		if (withHeaders) rows.push(headerFor(group, labels));
		for (const item of take) {
			rows.push(item);
			flat.push(item);
		}
		budget -= take.length;
	}

	return { rows, limit: rows.length, itemCount: flat.length, items: flat };
}

/** The item rows of an already-built list, in row order. */
export function itemsOf(rows: readonly OmniRow[]): OmniItem[] {
	const items: OmniItem[] = [];
	for (const row of rows) {
		if (row.kind !== "group-header") items.push(row);
	}
	return items;
}
