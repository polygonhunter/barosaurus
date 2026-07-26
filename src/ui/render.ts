import { renderResults, setIcon, type SearchResult } from "obsidian";
import { isGroupHeader, type GroupHeader, type OmniItem, type OmniRow } from "../core/types";
import { calloutIcon, iconForGroup, iconForItem } from "./icons";

/**
 * One row of the bar: preview tile, title, subtitle, trailing chips — or a
 * group overline, which occupies a row slot but is not a target.
 *
 * Two rules the whole file obeys:
 *  - Highlighting goes through obsidian's `renderResults`, never a hand-rolled
 *    <mark> and never innerHTML. The match ranges come from whoever produced
 *    the candidate; the fallback is plain text, never a guess.
 *  - The switch on `row.kind` is exhaustive, so a new OmniItem member is a
 *    compile error here instead of a blank row at runtime.
 */

export interface RowContext {
	/** Title match ranges, from the source or from the modal's own matcher. */
	match?: SearchResult | null;
	/** Zero-based position among ITEM rows; 0–8 get the ⌘1–9 chip. */
	ordinal?: number;
	/** Vault path → displayable URL, for thumbnail tiles. */
	resourcePath?: (path: string) => string | null;
}

/** How many ⌘-number shortcuts exist. */
const DIRECT_PICK_COUNT = 9;

export function renderRow(row: OmniRow, el: HTMLElement, ctx: RowContext = {}): void {
	if (isGroupHeader(row)) {
		renderGroupRow(row, el);
	} else {
		renderItemRow(row, el, ctx);
	}
}

/**
 * A group label. It is a real suggestion element — SuggestModal has no notion
 * of a non-item row — so it is made unselectable-looking in CSS (no hover, no
 * selected background, click-through) and ignored by onChooseSuggestion.
 */
export function renderGroupRow(header: GroupHeader, el: HTMLElement): void {
	el.addClass("barosaurus-group-row");
	el.setAttribute("aria-disabled", "true");
	const overline = el.createDiv({ cls: "barosaurus-group" });
	const iconEl = overline.createSpan({ cls: "barosaurus-group-icon" });
	setIcon(iconEl, iconForGroup(header.group));
	overline.createSpan({ cls: "barosaurus-group-label", text: header.label });
}

export function renderItemRow(item: OmniItem, el: HTMLElement, ctx: RowContext = {}): void {
	const shape = shapeOf(item);
	el.addClass("barosaurus-item");
	el.addClasses(shape.classes);

	// The pill measures THIS element, not the suggestion item, so a future
	// stacked layout cannot make the highlight swallow its own padding.
	const row = el.createDiv({ cls: "barosaurus-row" });
	renderTile(row, item, ctx);

	const label = row.createDiv({ cls: "barosaurus-label" });
	const titleEl = label.createDiv({ cls: "barosaurus-title" });
	renderTitle(titleEl, item.title, ctx.match ?? null);
	if (shape.subtitle.length > 0) {
		label.createDiv({ cls: "barosaurus-subtitle", text: shape.subtitle });
	}

	const trailing = row.createDiv({ cls: "barosaurus-trailing" });
	if (item.hotkey !== undefined && item.hotkey.length > 0) {
		trailing.createSpan({ cls: "barosaurus-hotkey", text: item.hotkey });
	}
	if (ctx.ordinal !== undefined && ctx.ordinal < DIRECT_PICK_COUNT) {
		// Always present, revealed by CSS only while ⌘/Ctrl is held.
		trailing.createSpan({ cls: "barosaurus-index", text: String(ctx.ordinal + 1) });
	}
}

/** Highlighted title, or plain text when there is nothing trustworthy to mark. */
function renderTitle(el: HTMLElement, text: string, match: SearchResult | null): void {
	if (match !== null && matchFits(text, match)) {
		renderResults(el, text, match);
		return;
	}
	el.setText(text);
}

/**
 * A match produced against an ALIAS carries offsets that do not exist in the
 * title; renderResults would then highlight the wrong characters. Cheaper to
 * verify than to trust.
 */
function matchFits(text: string, match: SearchResult): boolean {
	return match.matches.every(
		(part) => part[0] >= 0 && part[1] <= text.length && part[0] < part[1],
	);
}

// ------------------------------------------------------------------ shape

interface RowShape {
	classes: string[];
	subtitle: string;
}

/** Per-kind row trimmings. Exhaustive by construction. */
function shapeOf(item: OmniItem): RowShape {
	switch (item.kind) {
		case "command":
			return { classes: ["mod-command"], subtitle: item.subtitle ?? "" };
		case "action":
			return { classes: ["mod-action"], subtitle: item.subtitle ?? "" };
		case "file":
			return {
				classes: ["mod-file", `mod-${item.resultKind}`],
				subtitle: item.subtitle ?? parentFolder(item.path),
			};
		case "heading":
			return {
				classes: ["mod-heading"],
				subtitle: item.subtitle ?? `${hashes(item.level)} ${basename(item.path)}`,
			};
		case "block":
			return {
				classes: ["mod-block"],
				subtitle: item.subtitle ?? `^${item.blockId} · ${basename(item.path)}`,
			};
		case "tab":
			return {
				classes: ["mod-tab"],
				subtitle: item.subtitle ?? (item.path === undefined ? "" : parentFolder(item.path)),
			};
		case "bookmark":
			return {
				classes: ["mod-bookmark"],
				subtitle: item.subtitle ?? (item.path === undefined ? "" : parentFolder(item.path)),
			};
		case "folder":
			return { classes: ["mod-folder"], subtitle: item.subtitle ?? item.path };
		case "tag":
			return {
				classes: ["mod-tag"],
				subtitle: item.subtitle ?? `${item.count} ${item.count === 1 ? "note" : "notes"}`,
			};
		case "ghost":
			return { classes: ["mod-ghost", "is-quiet"], subtitle: item.subtitle ?? "Not created yet" };
		case "create":
			return { classes: ["mod-create", "is-quiet"], subtitle: item.subtitle ?? "Create note" };
	}
}

function hashes(level: number): string {
	return "#".repeat(Math.min(Math.max(Math.round(level), 1), 6));
}

function parentFolder(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? "" : path.slice(0, index);
}

function basename(path: string): string {
	const index = path.lastIndexOf("/");
	const name = index === -1 ? path : path.slice(index + 1);
	return name.endsWith(".md") ? name.slice(0, -3) : name;
}

// ------------------------------------------------------------------ tiles

/** The head of a row: what the item will look like, in the theme's own colors. */
export function renderTile(row: HTMLElement, item: OmniItem, ctx: RowContext = {}): void {
	const tile = row.createDiv({ cls: "barosaurus-tile" });
	const spec = item.tile;
	switch (spec.kind) {
		case "icon":
			iconTile(tile, spec.icon);
			break;
		case "callout": {
			tile.addClasses(["mod-callout", `mod-callout-${spec.calloutType}`]);
			const iconEl = tile.createSpan({ cls: "barosaurus-tile-icon" });
			setIcon(iconEl, calloutIcon(spec.calloutType));
			tile.createSpan({
				cls: "barosaurus-tile-name",
				text: spec.calloutType.charAt(0).toUpperCase() + spec.calloutType.slice(1),
			});
			break;
		}
		case "heading":
			tile.addClasses(["mod-heading", `mod-h${spec.level}`]);
			tile.createSpan({ text: `H${spec.level}` });
			break;
		case "quote":
			tile.addClass("mod-quote");
			tile.createSpan({ text: "Aa" });
			break;
		case "mono":
			tile.addClass("mod-code");
			tile.createSpan({ cls: "barosaurus-tile-mono", text: spec.sample });
			break;
		case "list":
			tile.addClass("mod-list");
			for (const lineNo of [0, 1]) {
				const line = tile.createDiv({ cls: "barosaurus-tile-line" });
				if (spec.marker === "bullet") {
					line.createSpan({ cls: "barosaurus-tile-marker", text: "•" });
				} else if (spec.marker === "number") {
					line.createSpan({ cls: "barosaurus-tile-marker", text: `${lineNo + 1}.` });
				} else {
					line.createDiv({ cls: "barosaurus-tile-checkbox" });
				}
				line.createDiv({ cls: "barosaurus-tile-bar" });
			}
			break;
		case "table": {
			tile.addClass("mod-table");
			const grid = tile.createDiv({ cls: "barosaurus-tile-grid" });
			for (let cell = 0; cell < 4; cell++) grid.createDiv();
			break;
		}
		case "divider":
			tile.addClass("mod-divider");
			tile.createDiv({ cls: "barosaurus-tile-hr" });
			break;
		case "swatch": {
			tile.addClass("mod-swatch");
			const dot = tile.createDiv({ cls: "barosaurus-tile-swatch" });
			// setCssStyles, never .style.x — the colour is data, not a stylesheet.
			dot.setCssStyles({ backgroundColor: spec.color });
			break;
		}
		case "thumbnail": {
			const src = ctx.resourcePath?.(spec.path) ?? null;
			if (src === null) {
				// No resolver, or the file is gone: fall back to the item's icon
				// rather than an empty frame.
				iconTile(tile, iconForItem(item));
				break;
			}
			tile.addClass("mod-thumbnail");
			tile.createEl("img", { attr: { src, alt: "" } });
			break;
		}
	}
}

function iconTile(tile: HTMLElement, icon: string): void {
	tile.addClass("mod-icon");
	const iconEl = tile.createSpan({ cls: "barosaurus-tile-icon" });
	setIcon(iconEl, icon);
}
