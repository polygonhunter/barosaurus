import {
	Modal,
	normalizePath,
	Notice,
	Setting,
	TFile,
	TFolder,
	type App,
	type PaneType,
	type TAbstractFile,
} from "obsidian";
import { togglePinned, toggleHidden } from "../core/actions";
import { handlesEditing, planEdit, type EditingSettings } from "../core/editing";
import type { OmniItem } from "../core/types";
import { createNotePath } from "../sources/create";
import { GOTO_LINE_PREFIX } from "../sources/line";
import { SETTINGS_ACTION_PREFIX } from "../sources/settings-tabs";
import { activeEditor } from "../services/context-service";
import {
	executeCommandById,
	findCommand,
	openGlobalSearch,
	openSettingsTab,
	revealInFileExplorer,
	showInSystemFolder,
} from "./unsafe";

/**
 * What actually happens when you pick a row or run an action.
 *
 * Arguments arrive as an already-collected `string[]` — the page stack does the
 * collecting (see src/ui/action-panel.ts), so this file never pushes a page and
 * never asks a question. It receives "move this file to Projects/2026" fully
 * formed and either does it or says why it could not.
 */

/**
 * Everything the executor may touch outside the App.
 *
 * All of it optional, deliberately: `src/main.ts` owns the wiring, and a host
 * that has not been extended yet must still compile and still run every action
 * that needs nothing from it. A missing member is a defined degraded state —
 * one notice naming what is not wired — never a throw.
 */
/**
 * Every member below is a *property holding a function*, not a method.
 *
 * That distinction is load-bearing rather than stylistic: these are injected
 * callbacks, and callers pull them out of the host (`const write = host.setPins`)
 * before deciding whether they exist. Method syntax would make each of those an
 * unbound-method extraction — `this` silently lost — which is both a real class
 * of bug and a hard error in the community-plugin lint.
 */
export interface ExecuteHost {
	app: App;
	/** Called after a successful pick so frecency can count it. */
	remember: (id: string) => void;
	/** Ids pinned to the top of the list, keyed by `item.id`. */
	pins?: () => readonly string[];
	setPins?: (next: string[]) => void;
	/** Raw command ids the user hid from this bar. */
	hiddenCommands?: () => readonly string[];
	setHiddenCommands?: (next: string[]) => void;
	/**
	 * Recent queries, newest first. The bar reads and rewrites the whole list
	 * (through `pushHistory`, which dedupes and bounds it) rather than asking
	 * the plugin to append — same read/write pair as pins and hidden commands,
	 * so `src/main.ts` stores and nothing more.
	 */
	history?: () => readonly string[];
	setHistory?: (next: string[]) => void;
	/**
	 * Colour mode, date pattern and snippets — everything core/editing.ts
	 * needs to plan a change to the note.
	 */
	editingSettings?: () => EditingSettings;
}

/**
 * What the bar should do once an action has run. "stay" is for the
 * list-keeping actions (pin, hide) — you do several in a row; everything else
 * is a destination and closing is the point.
 */
export type ActionOutcome = "close" | "stay";

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
				// The two prefix-encoded ids carry their argument in the id
				// itself, so they never reach runAction's switch.
				if (item.actionId.startsWith(SETTINGS_ACTION_PREFIX)) {
					openSettingsTab(app, item.actionId.slice(SETTINGS_ACTION_PREFIX.length));
					break;
				}
				if (item.actionId.startsWith(GOTO_LINE_PREFIX)) {
					gotoLine(app, Number(item.actionId.slice(GOTO_LINE_PREFIX.length)));
					break;
				}
				// Everything else goes through the one dispatcher. Without this
				// the case handled exactly those two prefixes and fell out of
				// the switch for every other verb, so an action row picked with
				// Enter did nothing at all — colour, alignment, turn-into-task,
				// callouts, dates, snippets, the lot. They worked only from the
				// ⌘K panel, which is the only other caller of runAction, which
				// is why commands looked fine while actions looked dead.
				await runAction(host, item.actionId, item);
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

/**
 * Run one action on one item.
 *
 * `args` is what the flow collected, in the order the action declared its
 * arguments — empty for the single-step ones. The return value tells the bar
 * whether to close.
 */
export async function runAction(
	host: ExecuteHost,
	actionId: string,
	item: OmniItem,
	args: readonly string[] = [],
): Promise<ActionOutcome> {
	const { app } = host;
	try {
		switch (actionId) {
			// ------------------------------------------------------- opening
			case "run":
			case "open":
			case "create-note":
				await choose(host, item, false);
				return "close";
			case "open-new-tab":
				await choose(host, item, "tab");
				return "close";
			case "open-split":
				await choose(host, item, "split");
				return "close";
			case "open-window":
				await choose(host, item, "window");
				return "close";

			// ------------------------------------------------------- linking
			case "insert-link":
				return insertLink(app, item) ? "close" : "stay";
			case "copy-link":
				await copyLink(app, item);
				return "close";
			case "copy-uri":
				await copyUri(app, item);
				return "close";

			// ------------------------------------------------------ file ops
			case "rename":
				await renameTo(app, item, args[0] ?? "");
				return "close";
			case "move":
				await moveTo(app, item, args[0] ?? "");
				return "close";
			case "add-tag":
				await addTag(app, item, args[0] ?? "");
				return "close";
			case "delete":
				await confirmAndTrash(app, item);
				return "close";
			case "bookmark":
				await bookmark(host, item);
				return "close";
			case "append-daily":
				await appendToDailyNote(app, item);
				return "close";
			case "reveal-explorer": {
				const path = pathOf(item);
				if (path === null) return "close";
				if (!revealInFileExplorer(app, path)) {
					new Notice("Barosaurus: the file explorer is unavailable");
				}
				return "close";
			}
			case "reveal-system": {
				const path = pathOf(item);
				if (path === null) return "close";
				// Desktop only by nature; on mobile the internal is simply
				// absent, and the guard turns that into a notice.
				if (!showInSystemFolder(app, path)) {
					new Notice("Barosaurus: this platform has no file manager to open");
				}
				return "close";
			}

			// ------------------------------------------------------ commands
			case "assign-hotkey":
				assignHotkey(app, item);
				return "close";
			case "pin":
				return togglePin(host, item);
			case "hide":
				return hideCommand(host, item);
			case "run-command-on":
				await runCommandOn(host, item, args[0] ?? "");
				return "close";

			// ----------------------------------------------------- selection
			case "extract-note":
				await extractToNote(app, item, args[0] ?? "");
				return "close";
			default:
				// Every remaining verb that touches the note itself — colour,
				// alignment, task/bullet/quote conversion, callouts, dates,
				// snippets, blocks — is planned purely in core/editing.ts and
				// only applied here. One route rather than a branch per verb.
				if (handlesEditing(actionId)) {
					return applyEdit(host, actionId, args[0] ?? null);
				}
				new Notice("Barosaurus: that action is not available yet");
				return "close";
		}
	} catch (error) {
		console.error("Barosaurus: action failed", error);
		new Notice(`Barosaurus: ${error instanceof Error ? error.message : String(error)}`);
		return "close";
	}
}

// -------------------------------------------------------------- file ops

/** The vault object behind an item, or null when it has no path (or is gone). */
function abstractFileOf(app: App, item: OmniItem): TAbstractFile | null {
	const path = pathOf(item);
	if (path === null) return null;
	return app.vault.getAbstractFileByPath(path);
}

/** Everything after the last slash; "" at the vault root. */
function parentOf(path: string): string {
	const cut = path.lastIndexOf("/");
	return cut <= 0 ? "" : path.slice(0, cut);
}

/** Join a folder and a name into a normalized vault path. */
function childPath(folder: string, name: string): string {
	return normalizePath(folder.length === 0 ? name : `${folder}/${name}`);
}

/**
 * `FileManager.renameFile`, never `vault.rename`: only the file manager
 * rewrites the links pointing AT the file, which is the entire difference
 * between renaming a note and quietly breaking every reference to it.
 */
async function renameTo(app: App, item: OmniItem, rawName: string): Promise<void> {
	const file = abstractFileOf(app, item);
	if (file === null) {
		new Notice("Barosaurus: that file is gone");
		return;
	}
	const name = rawName.trim();
	if (name.length === 0) return;
	// A typed name keeps the old extension unless the user gave one, so
	// renaming "notes.md" to "ideas" does not produce an extensionless file.
	const extension = file instanceof TFile ? file.extension : "";
	const hasExtension = extension.length > 0 && name.toLowerCase().endsWith(`.${extension}`);
	const filename = hasExtension || extension.length === 0 ? name : `${name}.${extension}`;
	const target = childPath(parentOf(file.path), filename);
	if (target === file.path) return;
	if (app.vault.getAbstractFileByPath(target) !== null) {
		new Notice(`Barosaurus: “${filename}” already exists here`);
		return;
	}
	await app.fileManager.renameFile(file, target);
	new Notice(`Renamed to “${filename}”`);
}

/** A move is a rename that keeps the name and changes the folder. */
async function moveTo(app: App, item: OmniItem, folder: string): Promise<void> {
	const file = abstractFileOf(app, item);
	if (file === null) {
		new Notice("Barosaurus: that file is gone");
		return;
	}
	const target = childPath(normalizePath(folder), file.name);
	if (target === file.path) return;
	// Moving a folder into itself would take the vault with it.
	if (file instanceof TFolder && target.startsWith(`${file.path}/`)) {
		new Notice("Barosaurus: a folder cannot be moved into itself");
		return;
	}
	if (app.vault.getAbstractFileByPath(target) !== null) {
		new Notice(`Barosaurus: “${file.name}” already exists there`);
		return;
	}
	await app.fileManager.renameFile(file, target);
	new Notice(`Moved to ${folder.length === 0 ? "the vault root" : folder}`);
}

/** Frontmatter tags, through the public `processFrontMatter` (@since 1.4.4). */
async function addTag(app: App, item: OmniItem, rawTag: string): Promise<void> {
	const path = pathOf(item);
	const file = path === null ? null : app.vault.getFileByPath(path);
	if (file === null) {
		new Notice("Barosaurus: that file is gone");
		return;
	}
	const tag = rawTag.trim().replace(/^#/, "");
	if (tag.length === 0) return;
	await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
		const existing: unknown = frontmatter["tags"];
		// `tags:` is a list in most vaults and a bare string in plenty of
		// others; both have to survive being added to.
		const tags =
			typeof existing === "string"
				? existing.split(",").map((entry) => entry.trim())
				: Array.isArray(existing)
					? existing.filter((entry): entry is string => typeof entry === "string")
					: [];
		if (tags.includes(tag)) return;
		frontmatter["tags"] = [...tags, tag];
	});
	new Notice(`Tagged #${tag}`);
}

/**
 * The one irreversible action, so it asks first and names what it is about to
 * delete.
 *
 * Not `fileManager.promptForDeletion`: that obeys the vault's global "confirm
 * before deleting" preference, and a row you merely highlighted in a search bar
 * is a far easier thing to delete by accident than a file you right-clicked in
 * the explorer. `ConfirmationModal` is 1.13+ and below our floor, so the dialog
 * is thirty lines of our own.
 *
 * `FileManager.trashFile` (@since 1.6.6), not `vault.trash`: it respects
 * whether the user asked for the system bin or the vault's .trash folder.
 */
async function confirmAndTrash(app: App, item: OmniItem): Promise<void> {
	const file = abstractFileOf(app, item);
	if (file === null) {
		new Notice("Barosaurus: that file is gone");
		return;
	}
	const isFolder = file instanceof TFolder;
	const confirmed = await confirm(app, {
		title: isFolder ? "Delete folder?" : "Delete file?",
		body: isFolder
			? `“${file.name}” and everything inside it will be moved to the trash.`
			: `“${file.name}” will be moved to the trash.`,
		confirmText: "Delete",
	});
	if (!confirmed) return;
	await app.fileManager.trashFile(file);
	new Notice(`Deleted “${file.name}”`);
}

// ------------------------------------------------------------ core plugins

/**
 * Bookmark the item.
 *
 * The bookmarks plugin exposes no add method we have an accessor for, so this
 * takes the route the user would: open the thing, then run the plugin's own
 * command against the view that is now current. Everything it touches is
 * either public API or an existing accessor in the quarantine, and a build
 * without the command degrades to a notice.
 */
const BOOKMARK_COMMANDS = [
	"bookmarks:bookmark-current-view",
	"bookmarks:bookmark-current-file",
];

async function bookmark(host: ExecuteHost, item: OmniItem): Promise<void> {
	const { app } = host;
	const command = BOOKMARK_COMMANDS.find((id) => findCommand(app, id) !== null);
	if (command === undefined) {
		new Notice("Barosaurus: bookmarking is unavailable in this build");
		return;
	}
	const path = pathOf(item);
	if (path !== null) await openPath(app, path, false);
	if (!executeCommandById(app, command)) {
		new Notice("Barosaurus: bookmarking is unavailable in this build");
		return;
	}
	new Notice(`Bookmarked “${item.title}”`);
}

/** Command ids that open today's note, newest naming first. */
const DAILY_NOTE_COMMANDS = ["daily-notes", "daily-notes:goto-today"];

/**
 * Append a link to the item to today's note.
 *
 * The daily-notes plugin keeps its folder and date format in its own settings,
 * which we have no accessor for — so today's note is reached by running the
 * plugin's own "open today" command and then reading `getActiveFile()`, which
 * is public. The command may create the note, so the answer arrives on a later
 * tick: we wait for the `file-open` that follows, with a timeout so a build
 * that never fires one degrades to a notice instead of hanging.
 */
async function appendToDailyNote(app: App, item: OmniItem): Promise<void> {
	const command = DAILY_NOTE_COMMANDS.find((id) => findCommand(app, id) !== null);
	if (command === undefined) {
		new Notice("Barosaurus: daily notes are not enabled");
		return;
	}
	const before = app.workspace.getActiveFile();
	if (!executeCommandById(app, command)) {
		new Notice("Barosaurus: daily notes are not enabled");
		return;
	}
	const daily = await waitForActiveFile(app, before);
	if (daily === null) {
		new Notice("Barosaurus: could not open today's note");
		return;
	}
	const path = pathOf(item);
	const file = path === null ? null : app.vault.getFileByPath(path);
	const link =
		file instanceof TFile
			? app.fileManager.generateMarkdownLink(file, daily.path)
			: item.title;
	await app.vault.append(daily, `\n- ${link}`);
	new Notice(`Appended to “${daily.basename}”`);
}

/** How long to wait for the daily note to become active before giving up. */
const ACTIVE_FILE_TIMEOUT_MS = 3_000;

/**
 * The file that becomes active after a command ran. Resolves immediately when
 * the command opened something synchronously, otherwise on the next
 * `file-open`, and to whatever is active once the timeout expires.
 */
function waitForActiveFile(app: App, before: TFile | null): Promise<TFile | null> {
	const current = app.workspace.getActiveFile();
	if (current !== null && current !== before) return Promise.resolve(current);
	return new Promise((resolve) => {
		let done = false;
		const finish = (file: TFile | null): void => {
			if (done) return;
			done = true;
			app.workspace.offref(ref);
			window.clearTimeout(timer);
			resolve(file);
		};
		const ref = app.workspace.on("file-open", (file) => finish(file));
		// `window`, not `activeWindow`, and deliberately so: a timer has no DOM
		// to belong to, and activeWindow can change between scheduling and
		// clearing — then clearTimeout runs against a different window's queue
		// and silently does nothing while the callback still fires. Only nodes
		// need the popout-aware accessor.
		const timer = window.setTimeout(
			() => finish(app.workspace.getActiveFile()),
			ACTIVE_FILE_TIMEOUT_MS,
		);
	});
}

/**
 * Settings → Hotkeys, as close to the command as we can get: the search field
 * inside that tab is an internal with no accessor, so the notice carries the
 * name to paste in rather than pretending the filter was applied.
 */
function assignHotkey(app: App, item: OmniItem): void {
	if (item.kind !== "command") return;
	if (!openSettingsTab(app, "hotkeys")) {
		new Notice("Barosaurus: the settings window is unavailable");
		return;
	}
	new Notice(`Search for “${item.title}” to give it a hotkey`);
}

// ------------------------------------------------------------ list keeping

/**
 * ⌘P. Keyed by `item.id` — the same key the ranker reads and the same key
 * `fileItemId()` mints for files, so a pin set here is a pin the ranking sees.
 */
function togglePin(host: ExecuteHost, item: OmniItem): ActionOutcome {
	const read = host.pins;
	const write = host.setPins;
	if (read === undefined || write === undefined) {
		new Notice("Barosaurus: pinning is not available");
		return "stay";
	}
	const before = read();
	const wasPinned = before.includes(item.id);
	write(togglePinned(before, item.id));
	new Notice(wasPinned ? `Unpinned “${item.title}”` : `Pinned “${item.title}”`);
	return "stay";
}

function hideCommand(host: ExecuteHost, item: OmniItem): ActionOutcome {
	if (item.kind !== "command") return "stay";
	const read = host.hiddenCommands;
	const write = host.setHiddenCommands;
	if (read === undefined || write === undefined) {
		new Notice("Barosaurus: hiding is not available");
		return "stay";
	}
	write(toggleHidden(read(), item.commandId));
	new Notice(`Hid “${item.title}” — it still works everywhere else`);
	return "stay";
}

/**
 * Run any command with the item as the thing it acts on. Obsidian's commands
 * act on whatever is current, so the item is opened first and the command runs
 * against it — the only meaning "run this command ON this" can have.
 */
async function runCommandOn(host: ExecuteHost, item: OmniItem, commandId: string): Promise<void> {
	const { app } = host;
	if (commandId.length === 0) return;
	const command = findCommand(app, commandId);
	if (command === null) {
		new Notice("Barosaurus: that command is gone");
		return;
	}
	const path = pathOf(item);
	if (path !== null) await openPath(app, path, false);
	if (!executeCommandById(app, commandId)) {
		new Notice(`Barosaurus: “${command.name}” could not run`);
	}
}

// ---------------------------------------------------------------- selection

/**
 * Lift the selection into a new note and leave a link behind. The selection is
 * the note's body, so nothing is lost if the link is later removed.
 */
async function extractToNote(app: App, _item: OmniItem, rawTitle: string): Promise<void> {
	const editor = activeEditor(app);
	const title = rawTitle.trim();
	if (editor === null || title.length === 0) return;
	const selection = editor.getSelection();
	if (selection.length === 0) {
		new Notice("Barosaurus: nothing is selected");
		return;
	}
	const sourcePath = app.workspace.getActiveFile()?.path ?? "";
	const parent = app.fileManager.getNewFileParent(sourcePath);
	const path = createNotePath(title, parent.path);
	if (app.vault.getAbstractFileByPath(path) !== null) {
		new Notice(`Barosaurus: “${title}” already exists`);
		return;
	}
	const file = await app.vault.create(path, selection);
	editor.replaceSelection(app.fileManager.generateMarkdownLink(file, sourcePath));
	new Notice(`Extracted to “${title}”`);
}

/** Warned once per session, not once per use — see EditingResult. */
let warnedAboutMarkdownInHtml = false;

/**
 * Apply an editing verb. All of the thinking happens in core/editing.ts, which
 * is pure and unit-tested; this supplies the editor, the settings and the
 * document, then writes the plan back.
 */
function applyEdit(host: ExecuteHost, actionId: string, argument: string | null): ActionOutcome {
	const editor = activeEditor(host.app);
	if (editor === null) {
		new Notice("Barosaurus: no editor is open");
		return "close";
	}
	const selection = editor.getSelection();
	const plan = planEdit({
		actionId,
		selection,
		argument,
		settings: host.editingSettings?.() ?? {
			colorMode: "theme",
			dateFormat: "YYYY-MM-DD",
			snippets: [],
		},
		document: editor.getValue(),
	});
	if (plan === null) {
		new Notice("Barosaurus: that action needs something it did not get");
		return "close";
	}

	const from = editor.getCursor("from");
	editor.replaceSelection(plan.text);
	// lineDelta 0 means ch is a delta from the insertion column; beyond that it
	// is an absolute column. The asymmetry is documented on InsertPlan.
	editor.setCursor({
		line: from.line + plan.cursor.lineDelta,
		ch: plan.cursor.lineDelta === 0 ? from.ch + plan.cursor.ch : plan.cursor.ch,
	});

	if (plan.appendToDocument !== undefined) {
		const last = editor.lastLine();
		editor.replaceRange(plan.appendToDocument, {
			line: last,
			ch: editor.getLine(last).length,
		});
	}

	if (plan.markdownInsideHtml && !warnedAboutMarkdownInHtml) {
		warnedAboutMarkdownInHtml = true;
		new Notice(
			"Barosaurus: Obsidian does not render Markdown inside HTML, so formatting inside a coloured span may show its syntax.",
			8000,
		);
	}
	return "close";
}

// ----------------------------------------------------------------- confirm

interface ConfirmSpec {
	title: string;
	body: string;
	confirmText: string;
}

/**
 * A yes/no dialog, hand-built because `ConfirmationModal` arrived in 1.13 and
 * our floor is 1.12.4. Resolves false on Esc and on the close button, so the
 * only path to `true` is the button that says what it will do.
 */
class ConfirmModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private readonly spec: ConfirmSpec,
		private readonly resolve: (ok: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.spec.title);
		this.contentEl.addClass("barosaurus-confirm");
		this.contentEl.createEl("p", { text: this.spec.body });
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => this.finish(false)),
			)
			.addButton((button) =>
				button
					.setButtonText(this.spec.confirmText)
					.setWarning()
					.onClick(() => this.finish(true)),
			);
	}

	private finish(ok: boolean): void {
		this.answered = ok;
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve(this.answered);
	}
}

function confirm(app: App, spec: ConfirmSpec): Promise<boolean> {
	return new Promise((resolve) => new ConfirmModal(app, spec, resolve).open());
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

/**
 * True when a link was really inserted. The caller closes the bar on true and
 * leaves it alone on false, so Tab on a command row does nothing visible
 * rather than half-acting.
 */
function insertLink(app: App, item: OmniItem): boolean {
	const editor = activeEditor(app);
	const path = pathOf(item);
	if (!editor || !path) return false;
	const file = app.vault.getFileByPath(path);
	if (!(file instanceof TFile)) return false;
	const sourcePath = app.workspace.getActiveFile()?.path ?? "";
	editor.replaceSelection(app.fileManager.generateMarkdownLink(file, sourcePath));
	return true;
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
