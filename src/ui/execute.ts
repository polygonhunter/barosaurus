import { Notice, TFile, type App, type PaneType } from "obsidian";
import type { OmniItem } from "../core/types";
import { createNotePath } from "../sources/create";
import { GOTO_LINE_PREFIX } from "../sources/line";
import { SETTINGS_ACTION_PREFIX } from "../sources/settings-tabs";
import { activeEditor } from "../services/context-service";
import {
	executeCommandById,
	openGlobalSearch,
	openSettingsTab,
	revealInFileExplorer,
} from "./unsafe";

/**
 * What actually happens when you pick a row or run an action.
 *
 * Single-step actions only. Anything that needs an argument — Move to…,
 * Rename…, a colour — is a multi-step flow owned by the page stack and is
 * wired separately; those ids are not handled here and fall through to a
 * Notice rather than failing silently.
 */

export interface ExecuteHost {
	app: App;
	/** Called after a successful pick so frecency can count it. */
	remember(id: string): void;
}

/** Enter, and the ⌘-modified Enters. */
export async function choose(
	host: ExecuteHost,
	item: OmniItem,
	paneType: PaneType | boolean,
): Promise<void> {
	const { app } = host;
	try {
		switch (item.kind) {
			case "command": {
				// Close first: a command that opens its own modal must not fight
				// ours for focus.
				if (!executeCommandById(app, item.commandId)) {
					new Notice(`Barosaurus: “${item.title}” could not run`);
					return;
				}
				break;
			}
			case "action": {
				if (item.actionId.startsWith(SETTINGS_ACTION_PREFIX)) {
					openSettingsTab(app, item.actionId.slice(SETTINGS_ACTION_PREFIX.length));
				} else if (item.actionId.startsWith(GOTO_LINE_PREFIX)) {
					gotoLine(app, Number(item.actionId.slice(GOTO_LINE_PREFIX.length)));
				}
				break;
			}
			case "file":
				await openPath(app, item.path, paneType, item.line);
				break;
			case "heading":
			case "block":
				await openPath(app, item.path, paneType, item.line);
				break;
			case "bookmark":
				if (item.path) await openPath(app, item.path, paneType);
				break;
			case "tab":
				await activateTab(app, item.leafId, item.path, paneType);
				break;
			case "folder":
				// A folder has nothing to open; reveal it where folders live.
				revealInFileExplorer(app, item.path);
				break;
			case "tag":
				// NOT openLinkText: that resolves a wikilink, so an unresolved
				// "tag:project" would create a note by that name in the user's
				// vault. The search pane is the only correct target.
				if (!openGlobalSearch(app, `tag:${item.tag}`)) {
					new Notice("Barosaurus: the search pane is unavailable");
					return;
				}
				break;
			case "ghost":
				await createNote(app, item.linktext, null, paneType);
				break;
			case "create":
				// The row showed a path; create exactly that one.
				await createNote(app, item.query, item.path, paneType);
				break;
		}
		host.remember(item.id);
	} catch (error) {
		console.error("Barosaurus: failed to run the selection", error);
		new Notice(
			`Barosaurus: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/** Named actions that need no argument. */
export async function runAction(
	host: ExecuteHost,
	actionId: string,
	item: OmniItem,
): Promise<void> {
	const { app } = host;
	try {
		switch (actionId) {
			case "insert-link":
				insertLink(app, item);
				return;
			case "copy-link":
				await copyLink(app, item);
				return;
			case "copy-uri":
				await copyUri(app, item);
				return;
			case "reveal-explorer":
				if (pathOf(item)) revealInFileExplorer(app, pathOf(item) ?? "");
				return;
			case "open-new-tab":
				await choose(host, item, "tab");
				return;
			case "open-split":
				await choose(host, item, "split");
				return;
			case "open-window":
				await choose(host, item, "window");
				return;
			default:
				// Multi-step actions are not ours; say so rather than no-op.
				new Notice("Barosaurus: that action is not available yet");
				return;
		}
	} catch (error) {
		console.error("Barosaurus: action failed", error);
		new Notice(`Barosaurus: ${error instanceof Error ? error.message : String(error)}`);
	}
}

// ------------------------------------------------------------------ helpers

function pathOf(item: OmniItem): string | null {
	if (
		item.kind === "file" ||
		item.kind === "heading" ||
		item.kind === "block" ||
		item.kind === "folder"
	) {
		return item.path;
	}
	if (item.kind === "bookmark" || item.kind === "tab") return item.path ?? null;
	return null;
}

async function openPath(
	app: App,
	path: string,
	paneType: PaneType | boolean,
	line?: number,
): Promise<void> {
	const file = app.vault.getFileByPath(path);
	if (!file) {
		new Notice("Barosaurus: that file is gone");
		return;
	}
	const leaf = app.workspace.getLeaf(paneType);
	await leaf.openFile(file, line === undefined ? undefined : { eState: { line } });
}

/** `:42` — the editor counts lines from 0, the user counts from 1. */
function gotoLine(app: App, line: number): void {
	const editor = activeEditor(app);
	if (!editor || !Number.isFinite(line)) return;
	const target = Math.min(Math.max(line - 1, 0), editor.lastLine());
	editor.setCursor({ line: target, ch: 0 });
	editor.scrollIntoView({ from: { line: target, ch: 0 }, to: { line: target, ch: 0 } }, true);
	editor.focus();
}

/**
 * Activate the tab that already holds this thing, rather than opening its file
 * again. Opening in the current leaf would replace whatever the user was
 * looking at — the opposite of what "go to that tab" means.
 */
async function activateTab(
	app: App,
	leafId: string,
	path: string | undefined,
	paneType: PaneType | boolean,
): Promise<void> {
	// getLeafById is public since 1.5.1, comfortably under our 1.12.4 floor.
	const leaf = leafId.length > 0 ? app.workspace.getLeafById(leafId) : null;
	if (leaf) {
		await app.workspace.revealLeaf(leaf);
		return;
	}
	// The leaf is gone (closed since the list was built). Fall back to the file
	// if there is one; a view without a file simply has nothing left to show.
	if (path) {
		await openPath(app, path, paneType);
		return;
	}
	new Notice("Barosaurus: that tab is gone");
}

/**
 * `explicitPath` is the path a Create row already showed the user — sanitised
 * and folded into any `p:` prefix. Passing null means "work it out", which is
 * what a ghost link needs.
 */
async function createNote(
	app: App,
	title: string,
	explicitPath: string | null,
	paneType: PaneType | boolean,
): Promise<void> {
	let path = explicitPath;
	if (path === null) {
		const parent = app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path ?? "");
		path = createNotePath(title, parent.path);
	}
	const existing = app.vault.getFileByPath(path);
	const file = existing ?? (await app.vault.create(path, ""));
	await app.workspace.getLeaf(paneType).openFile(file);
}

function insertLink(app: App, item: OmniItem): void {
	const editor = activeEditor(app);
	const path = pathOf(item);
	if (!editor || !path) return;
	const file = app.vault.getFileByPath(path);
	if (!(file instanceof TFile)) return;
	const sourcePath = app.workspace.getActiveFile()?.path ?? "";
	editor.replaceSelection(app.fileManager.generateMarkdownLink(file, sourcePath));
}

async function copyLink(app: App, item: OmniItem): Promise<void> {
	const path = pathOf(item);
	if (!path) return;
	const file = app.vault.getFileByPath(path);
	if (!(file instanceof TFile)) return;
	const link = app.fileManager.generateMarkdownLink(file, "");
	await navigator.clipboard.writeText(link);
	new Notice("Link copied");
}

async function copyUri(app: App, item: OmniItem): Promise<void> {
	const path = pathOf(item);
	if (!path) return;
	// vault.getName() is public — no need to reach for the undocumented appId.
	const uri = `obsidian://open?vault=${encodeURIComponent(
		app.vault.getName(),
	)}&file=${encodeURIComponent(path)}`;
	await navigator.clipboard.writeText(uri);
	new Notice("Obsidian URI copied");
}
