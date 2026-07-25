import type { GroupId, TileSpec } from "./types";

/**
 * The insertion model: what gets written into the note when an item is
 * chosen. Kept apart from types.ts because the bar's ITEM model (what you
 * search) and its BLOCK model (what you insert) evolve independently — most
 * items insert nothing at all.
 */

/** How a text selection is folded into a template. */
export type WrapKind = "inline" | "prefixLines" | "fenced" | "none";

export interface BlockDef {
	id: string;
	name: string;
	aliases: string[];
	group: GroupId;
	/** May contain {cursor}, {date}, {fold}, {lang}. */
	template: string;
	wrap: WrapKind;
	/** Only for wrap === "prefixLines". */
	linePrefix?: string;
	tile: TileSpec;
	/** Entries that are not a plain template insert. */
	special?: "codeblock" | "footnote" | "date" | "command";
	foldable?: boolean;
	/** Only for special === "command". */
	commandId?: string;
	/** Hidden unless this community plugin is installed and enabled. */
	requiresPlugin?: string;
}

export interface TemplateEnv {
	selection: string | null;
	date: string;
	folded: boolean;
	language: string | null;
}

export interface InsertPlan {
	text: string;
	/**
	 * Where the cursor lands, relative to the insertion start. Asymmetric on
	 * purpose: lineDelta === 0 means `ch` is a DELTA from the insertion
	 * column, lineDelta > 0 means `ch` is an ABSOLUTE column.
	 */
	cursor: { lineDelta: number; ch: number };
}

export interface UserSnippet {
	name: string;
	template: string;
}
