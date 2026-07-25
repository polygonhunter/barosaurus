/** Pure vault-path helpers: exclusion checks and folder arithmetic. */

/**
 * Drop trailing slashes without a regex.
 *
 * This is called once per excluded folder per file per keystroke on the hot
 * path, and `String.replace` with a regex allocates on every call — the loop
 * does not.
 */
function trimTrailingSlashes(raw: string): string {
	let end = raw.length;
	while (end > 0 && raw[end - 1] === "/") end -= 1;
	return end === raw.length ? raw : raw.slice(0, end);
}

/**
 * The usable entries of an exclusion list: slash-trimmed, empties dropped.
 * An empty entry is a just-added, not-yet-filled settings row and must never
 * match — it would exclude the entire vault.
 */
export function normalizeExcludedFolders(folders: readonly string[]): string[] {
	const out: string[] = [];
	for (const raw of folders) {
		const folder = trimTrailingSlashes(raw);
		if (folder.length > 0) out.push(folder);
	}
	return out;
}

/**
 * Is `path` inside any of the excluded folders? Boundary-aware:
 * "templates" excludes "templates/a.md" but NOT "templates2.md".
 * Empty entries (a just-added, not-yet-picked settings row) never match.
 */
export function isPathExcluded(path: string, folders: readonly string[]): boolean {
	for (const raw of folders) {
		const folder = trimTrailingSlashes(raw);
		if (folder.length === 0) continue;
		if (path === folder || path.startsWith(`${folder}/`)) return true;
	}
	return false;
}

/**
 * The per-keystroke shape of `isPathExcluded`: normalize the list ONCE, then
 * test many paths against it.
 *
 * The empty case returns a constant `false` predicate, because that is what
 * almost every vault has configured and a source that filters must not pay for
 * a feature nobody switched on.
 */
export function pathExcluder(folders: readonly string[]): (path: string) => boolean {
	const normalized = normalizeExcludedFolders(folders);
	if (normalized.length === 0) return () => false;
	return (path: string): boolean => {
		for (const folder of normalized) {
			if (path === folder || path.startsWith(`${folder}/`)) return true;
		}
		return false;
	};
}

/**
 * Folder of a path, or undefined at the vault root.
 *
 * Lives here rather than in the files source because the full-text source needs
 * it too, and that one must stay free of obsidian so it can be tested without a
 * shim — importing it from `sources/files.ts` would drag in
 * `prepareFuzzySearch` at runtime.
 */
export function folderOf(path: string): string | undefined {
	const cut = path.lastIndexOf("/");
	return cut <= 0 ? undefined : path.slice(0, cut);
}
