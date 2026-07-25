import type { BlockDef, InsertPlan, TemplateEnv } from "./blocks";
import { embedSelection } from "./wrap";

const CURSOR = "{cursor}";

/**
 * Resolve a template into the final text plus the cursor position relative to
 * the insertion start. Placeholders: {lang}, {fold}, {date}, {cursor}.
 */
export function buildInsertion(def: BlockDef, env: TemplateEnv): InsertPlan {
	let template = def.template
		.replace("{lang}", env.language ?? "")
		.replace("{fold}", env.folded ? "-" : "")
		.replace("{date}", env.date);
	if (env.selection !== null && env.selection.length > 0) {
		template = embedSelection(template, env.selection, def.wrap, def.linePrefix ?? "");
	}
	return resolveCursor(template);
}

/** Strip the {cursor} sentinel and compute where it was, multi-line safe. */
export function resolveCursor(template: string): InsertPlan {
	const idx = template.indexOf(CURSOR);
	const text = template.replace(CURSOR, "");
	// No sentinel → cursor at the very end of the inserted text.
	const before = idx === -1 ? text : template.slice(0, idx);
	const lines = before.split("\n");
	return {
		text,
		cursor: {
			lineDelta: lines.length - 1,
			ch: lines[lines.length - 1]?.length ?? 0,
		},
	};
}
