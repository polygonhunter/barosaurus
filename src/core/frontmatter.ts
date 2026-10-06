/**
 * Frontmatter values as the bar reads and writes them. Pure — the executor and
 * the pickers supply the frontmatter objects, this decides the shapes.
 */

/**
 * The value to write for `raw`, shaped like what the field already holds.
 *
 * - a LIST stays a list: "a, b" becomes ["a", "b"] (never the string "a, b")
 * - a boolean stays a boolean when the input is true/false
 * - a number stays a number when the input is a finite number
 * - everything else, and every field that does not exist yet, is text
 *
 * Writing "true" as a string into a checkbox property turned it into a text
 * property in Obsidian's eyes; this keeps the type the user already chose.
 */
export function coercePropertyValue(existing: unknown, raw: string): unknown {
	const value = raw.trim();
	if (Array.isArray(existing)) {
		return value
			.split(",")
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
	}
	if (typeof existing === "boolean") {
		const lower = value.toLowerCase();
		if (lower === "true") return true;
		if (lower === "false") return false;
		return value;
	}
	if (typeof existing === "number" && value.length > 0) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return value;
}

/** A frontmatter value as the text a user would type for it; "" for objects. */
export function formatPropertyValue(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (Array.isArray(value)) return value.map(formatPropertyValue).filter((v) => v.length > 0).join(", ");
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "";
}

/**
 * Every distinct value `key` has across the given frontmatters, with how many
 * notes use it, most used first. List fields count each entry separately.
 */
export function collectPropertyValues(
	frontmatters: Iterable<Record<string, unknown> | null | undefined>,
	key: string,
): Array<{ value: string; count: number }> {
	const counts = new Map<string, number>();
	for (const frontmatter of frontmatters) {
		if (frontmatter === null || frontmatter === undefined || !(key in frontmatter)) continue;
		const raw = frontmatter[key];
		const values = Array.isArray(raw) ? raw : [raw];
		const seen = new Set<string>();
		for (const entry of values) {
			const text = formatPropertyValue(entry).trim();
			if (text.length === 0 || seen.has(text)) continue;
			seen.add(text);
			counts.set(text, (counts.get(text) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
