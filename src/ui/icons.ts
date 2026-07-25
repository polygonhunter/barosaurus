import type { GroupId, OmniItem, ResultKind } from "../core/types";

/**
 * Lucide names, rendered through Obsidian's `setIcon`. Kept in one file
 * because the same item is drawn in three places (tile, group overline,
 * breadcrumb) and a mapper per call site is how those drift apart.
 *
 * Every switch is exhaustive on a union from core/types, so adding a kind
 * breaks the build here rather than silently rendering a blank square.
 */

export function iconForResultKind(kind: ResultKind): string {
	switch (kind) {
		case "note":
			return "file-text";
		case "file":
			return "paperclip";
		case "image":
			return "image";
		case "link":
			return "link";
	}
}

/** The item's own icon — the fallback whenever its tile is not pictorial. */
export function iconForItem(item: OmniItem): string {
	switch (item.kind) {
		case "command":
			return "terminal";
		case "action":
			return "zap";
		case "file":
			return iconForResultKind(item.resultKind);
		case "heading":
			return "heading";
		case "block":
			return "align-left";
		case "tab":
			return "layers";
		case "bookmark":
			return "bookmark";
		case "folder":
			return "folder";
		case "tag":
			return "hash";
		case "ghost":
			return "file-plus";
		case "create":
			return "plus";
	}
}

export function iconForGroup(group: GroupId): string {
	switch (group) {
		case "actions":
			return "zap";
		case "commands":
			return "terminal";
		case "openTabs":
			return "layers";
		case "files":
			return "file-text";
		case "structure":
			return "heading";
		case "bookmarks":
			return "bookmark";
		case "folders":
			return "folder";
		case "tags":
			return "hash";
		case "fulltext":
			return "search";
		case "family":
			return "sparkles";
		case "create":
			return "plus";
	}
}

/**
 * Callout icons for the preview tile. Obsidian's own type→icon table is not
 * exported, so this mirrors the default set; an unknown (custom) callout type
 * falls back to the neutral pencil rather than rendering nothing.
 */
const CALLOUT_ICONS: Readonly<Record<string, string>> = {
	note: "pencil",
	abstract: "clipboard-list",
	summary: "clipboard-list",
	tldr: "clipboard-list",
	info: "info",
	todo: "check-circle-2",
	tip: "flame",
	hint: "flame",
	important: "flame",
	success: "check",
	check: "check",
	done: "check",
	question: "help-circle",
	help: "help-circle",
	faq: "help-circle",
	warning: "alert-triangle",
	caution: "alert-triangle",
	attention: "alert-triangle",
	failure: "x",
	fail: "x",
	missing: "x",
	danger: "zap",
	error: "zap",
	bug: "bug",
	example: "list",
	quote: "quote",
	cite: "quote",
};

export function calloutIcon(calloutType: string): string {
	return CALLOUT_ICONS[calloutType.toLowerCase()] ?? "pencil";
}
