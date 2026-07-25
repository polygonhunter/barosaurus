import type { WrapKind } from "./blocks";

/**
 * Embed a text selection into a block template. The selection replaces the
 * spot marked by {cursor}; where the marker ends up afterwards depends on the
 * wrap kind. Whatever happens, the selected text is never dropped.
 */

const CURSOR = "{cursor}";

/** "1. " → "3. " for the third line; non-numbered prefixes pass through. */
function prefixForLine(linePrefix: string, lineIndex: number): string {
	const numbered = /^(\d+)([.)] )$/.exec(linePrefix);
	if (!numbered || numbered[1] === undefined || numbered[2] === undefined) return linePrefix;
	return `${Number(numbered[1]) + lineIndex}${numbered[2]}`;
}

export function embedSelection(
	template: string,
	selection: string,
	kind: WrapKind,
	linePrefix: string,
): string {
	switch (kind) {
		case "inline":
			// Selection lands inside the construct, cursor right behind it.
			return template.replace(CURSOR, selection + CURSOR);
		case "prefixLines": {
			// First selection line sits behind the prefix the template already
			// carries; every further line gets its own prefix.
			const lines = selection.split("\n");
			const joined = lines
				.map((line, i) => (i === 0 ? line : prefixForLine(linePrefix, i) + line))
				.join("\n");
			return template.replace(CURSOR, joined + CURSOR);
		}
		case "fenced":
			// Selection fills the block, cursor continues below it.
			return template.replace(CURSOR, selection) + "\n" + CURSOR;
		case "none":
			// Block doesn't accept content — re-emit the selection above it.
			return selection + "\n" + template;
	}
}
