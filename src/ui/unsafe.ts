import type { Command } from "obsidian";

/**
 * The quarantine. Every undocumented Obsidian API the plugin touches lives
 * here, behind a narrow accessor that returns `null` / `false` / `[]` instead
 * of throwing. Nothing else in the repo may reach an internal, which makes
 * `grep -r "from \"./unsafe\"" src` the complete list of ways this plugin can
 * break when Obsidian changes.
 *
 * ## Why this file exists in this shape
 *
 * Better Command Palette (~39k users) reaches exactly the same internals and
 * has been broken since 2023. Its approach is a single widened type:
 *
 * ```ts
 * interface UnsafeAppInterface extends App {
 *   commands: { listCommands(): Command[], … },
 *   hotkeyManager: { getHotkeys(id): Hotkey[], … },
 *   internalPlugins: { getPluginById(id): { instance: { options: { pinned: [] } } } },
 * }
 * ```
 *
 * That shape is a genuinely useful map of what exists — it is where the member
 * names below come from. What it is not is safe: a widened cast tells the
 * compiler every field is present and non-null, so the first renamed member
 * turns into a `TypeError` at the deepest point of the chain, at runtime, in a
 * user's vault.
 *
 * We invert it:
 *
 *  - every field is treated as OPTIONAL and of UNKNOWN type,
 *  - every access is guarded (never a cast through a chain),
 *  - every function call is wrapped, so a third-party throw degrades this
 *    plugin instead of killing the keystroke,
 *  - the exported surface is a set of small verbs, not a widened `App`. One
 *    unsafe touch = one greppable call site with a defined fallback.
 *
 * ## Deliberately NOT here
 *
 * Anything with a public equivalent, because an unsafe accessor for a public
 * API is pure risk:
 *  - `app.appId` — `app.loadLocalStorage` / `saveLocalStorage` are public
 *    (@since 1.8.7) and already vault-scoped.
 *  - `vault.getName()`, `workspace.getLastOpenFiles()`, `leaf.getViewState()`,
 *    `leaf.isDeferred`, `metadataCache.getFileCache()`,
 *    `metadataCache.unresolvedLinks`, `getAllTags(cache)` — all public.
 *
 * ## Testability
 *
 * The `obsidian` package ships types but no runtime module, so this file must
 * stay importable under plain vitest: the only import is `import type`, and
 * every accessor takes the app as `unknown` rather than as `App`. That is also
 * the honest signature — at runtime we really do not know what we were handed.
 */

// ------------------------------------------------------------------ plumbing

type Dict = Record<string, unknown>;
type AnyFn = (...args: unknown[]) => unknown;

/** Result of a guarded call. `ok` is false when there was nothing to call. */
interface Call {
	ok: boolean;
	value: unknown;
}

const NOT_CALLED: Call = { ok: false, value: undefined };

/** Only reports each broken internal once — a search bar runs on keystrokes. */
const reported = new Set<string>();

function reportOnce(label: string, error: unknown): void {
	if (reported.has(label)) return;
	reported.add(label);
	console.error(`[barosaurus] internal API "${label}" failed — degrading`, error);
}

/** Forget which internals have already been reported. Tests use this. */
export function resetUnsafeReports(): void {
	reported.clear();
}

function dict(value: unknown): Dict | null {
	return typeof value === "object" && value !== null ? (value as Dict) : null;
}

function str(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function field(owner: unknown, name: string): unknown {
	const target = dict(owner);
	return target === null ? undefined : target[name];
}

/**
 * Call `owner[name](...args)` if it is actually a function, with `this` bound
 * to the owner, and never let it throw outwards. The one place in the plugin
 * where third-party code runs behind our own stack frame.
 */
function invoke(owner: unknown, name: string, args: unknown[], label: string): Call {
	const target = dict(owner);
	if (target === null) return NOT_CALLED;
	const candidate = target[name];
	if (typeof candidate !== "function") return NOT_CALLED;
	try {
		return { ok: true, value: (candidate as AnyFn).apply(target, args) };
	} catch (error) {
		reportOnce(label, error);
		return NOT_CALLED;
	}
}

function hasMethod(owner: unknown, name: string): boolean {
	return typeof field(owner, name) === "function";
}

// ------------------------------------------------------------------ commands

function commandRegistry(app: unknown): unknown {
	return field(app, "commands");
}

/** Keep only entries that really look like a Command (id + name strings). */
function asCommands(value: unknown): Command[] {
	const out: Command[] = [];
	for (const entry of list(value)) {
		const command = dict(entry);
		if (command === null) continue;
		if (typeof command["id"] !== "string" || typeof command["name"] !== "string") continue;
		out.push(command as unknown as Command);
	}
	return out;
}

/**
 * Every registered command, or `[]`. Falls back to the raw `commands.commands`
 * record when `listCommands()` is gone — the record has outlived several
 * renames of the method.
 */
export function listCommands(app: unknown): Command[] {
	const registry = commandRegistry(app);
	const listed = asCommands(invoke(registry, "listCommands", [], "commands.listCommands").value);
	if (listed.length > 0) return listed;
	const table = dict(field(registry, "commands"));
	return table === null ? [] : asCommands(Object.values(table));
}

/** One command by id, or null. */
export function findCommand(app: unknown, id: string): Command | null {
	const registry = commandRegistry(app);
	const found = asCommands([invoke(registry, "findCommand", [id], "commands.findCommand").value]);
	if (found[0] !== undefined) return found[0];
	const table = dict(field(registry, "commands"));
	const direct = asCommands([table === null ? undefined : table[id]]);
	return direct[0] ?? null;
}

/**
 * Run a command. False means "it did not run" — the caller shows a notice.
 *
 * GUESS: the real `executeCommandById` returns a boolean, but a build that
 * returns `undefined` is indistinguishable from a command that ran fine, so
 * anything other than an explicit `false` counts as executed. Erring the other
 * way would show a failure notice after a command that actually ran.
 */
export function executeCommandById(app: unknown, id: string): boolean {
	const call = invoke(
		commandRegistry(app),
		"executeCommandById",
		[id],
		"commands.executeCommandById",
	);
	return call.ok && call.value !== false;
}

// ------------------------------------------------------------------ hotkeys

interface RawHotkey {
	modifiers: string[];
	key: string;
}

/** null = "this member did not answer with a list", which is not the same as []. */
function asHotkeys(value: unknown): RawHotkey[] | null {
	if (!Array.isArray(value)) return null;
	const out: RawHotkey[] = [];
	for (const entry of value) {
		const hotkey = dict(entry);
		const key = str(hotkey?.["key"]);
		if (key === null) continue;
		const modifiers: string[] = [];
		for (const modifier of list(hotkey?.["modifiers"])) {
			const name = str(modifier);
			if (name !== null) modifiers.push(name);
		}
		out.push({ modifiers, key });
	}
	return out;
}

const MAC_MODIFIERS: Record<string, string> = {
	Mod: "⌘",
	Meta: "⌘",
	Ctrl: "⌃",
	Alt: "⌥",
	Shift: "⇧",
};

const OTHER_MODIFIERS: Record<string, string> = {
	Mod: "Ctrl",
	Meta: "Win",
	Ctrl: "Ctrl",
	Alt: "Alt",
	Shift: "Shift",
};

const KEY_SYMBOLS: Record<string, string> = {
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→",
	Enter: "↵",
	Tab: "⇥",
	Backspace: "⌫",
	Delete: "Del",
	Escape: "Esc",
	" ": "Space",
	Space: "Space",
};

/**
 * `Platform.isMacOS` would be the public answer, but importing it pulls the
 * obsidian runtime module into this file and it has none — the accessors must
 * stay unit-testable. Reading the user agent keeps the file import-free.
 */
function isAppleKeyboard(): boolean {
	const nav = dict((globalThis as { navigator?: unknown }).navigator);
	const platform = str(nav?.["platform"]) ?? "";
	const agent = str(nav?.["userAgent"]) ?? "";
	return /mac|iphone|ipad|ipod/i.test(`${platform} ${agent}`);
}

function formatHotkey(hotkey: RawHotkey): string {
	const mac = isAppleKeyboard();
	const table = mac ? MAC_MODIFIERS : OTHER_MODIFIERS;
	const parts = hotkey.modifiers.map((modifier) => table[modifier] ?? modifier);
	const key = KEY_SYMBOLS[hotkey.key] ?? (hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key);
	parts.push(key);
	return mac ? parts.join("") : parts.join("+");
}

/**
 * The chip shown on the right of a command row, or null when the command has
 * no hotkey. A customized hotkey wins over the default, and an EMPTY custom
 * list means "the user removed it" — which is why this is a `??` chain and not
 * a truthiness chain.
 */
export function getHotkeyChip(app: unknown, id: string): string | null {
	const manager = field(app, "hotkeyManager");
	const custom = asHotkeys(invoke(manager, "getHotkeys", [id], "hotkeyManager.getHotkeys").value);
	const defaults = asHotkeys(
		invoke(manager, "getDefaultHotkeys", [id], "hotkeyManager.getDefaultHotkeys").value,
	);
	const hotkey = (custom ?? defaults ?? [])[0];
	return hotkey === undefined ? null : formatHotkey(hotkey);
}

// ----------------------------------------------------------- internal plugins

function internalPluginRegistry(app: unknown): unknown {
	return field(app, "internalPlugins");
}

/** The registry entry (`{ enabled, instance }`) for a core plugin. */
function internalPluginEntry(app: unknown, id: string): unknown {
	const registry = internalPluginRegistry(app);
	const viaMethod = invoke(registry, "getPluginById", [id], "internalPlugins.getPluginById");
	if (viaMethod.ok && dict(viaMethod.value) !== null) return viaMethod.value;
	const table = dict(field(registry, "plugins"));
	return table === null ? undefined : table[id];
}

function internalPluginInstance(app: unknown, id: string): unknown {
	return field(internalPluginEntry(app, id), "instance");
}

function stringList(value: unknown): string[] {
	const out: string[] = [];
	for (const entry of list(value)) {
		const text = str(entry);
		if (text !== null) out.push(text);
	}
	return out;
}

/**
 * Command ids the user pinned in the built-in command palette, in their order.
 * Barosaurus shows them first rather than inventing its own pin store.
 */
export function getPinnedCommandIds(app: unknown): string[] {
	const options = field(internalPluginInstance(app, "command-palette"), "options");
	return stringList(field(options, "pinned"));
}

/** Ids of the enabled COMMUNITY plugins, for the `requiresPlugin` gates. */
export function getEnabledPluginIds(app: unknown): Set<string> {
	const plugins = field(app, "plugins");
	const ids = new Set<string>();
	const enabled = field(plugins, "enabledPlugins");
	if (enabled instanceof Set) {
		for (const entry of enabled) {
			const id = str(entry);
			if (id !== null) ids.add(id);
		}
	} else {
		for (const id of stringList(enabled)) ids.add(id);
	}
	if (ids.size > 0) return ids;
	// Fallback: the loaded-instance table. Present in every build so far, and
	// a loaded plugin is by definition an enabled one.
	const loaded = dict(field(plugins, "plugins"));
	if (loaded !== null) {
		for (const id of Object.keys(loaded)) {
			if (loaded[id] !== undefined && loaded[id] !== null) ids.add(id);
		}
	}
	return ids;
}

/** Is a CORE plugin (bookmarks, file explorer, daily notes…) turned on? */
export function isCorePluginEnabled(app: unknown, id: string): boolean {
	const registry = internalPluginRegistry(app);
	const direct = invoke(
		registry,
		"getEnabledPluginById",
		[id],
		"internalPlugins.getEnabledPluginById",
	);
	if (direct.ok) return direct.value !== null && direct.value !== undefined && direct.value !== false;
	const entry = internalPluginEntry(app, id);
	if (entry === undefined || entry === null) return false;
	const enabled = field(entry, "enabled");
	if (typeof enabled === "boolean") return enabled;
	// GUESS: builds that expose no `enabled` flag only attach `instance` to a
	// plugin that is running, so presence of the instance is the signal.
	return dict(field(entry, "instance")) !== null;
}

// ------------------------------------------------------------------ metadata

/**
 * Every tag in the vault with its usage count. The public `getAllTags(cache)`
 * is per-FILE and cannot answer this; there is no public vault-wide tag list.
 */
export function getAllVaultTags(app: unknown): Array<{ tag: string; count: number }> {
	const raw = dict(invoke(field(app, "metadataCache"), "getTags", [], "metadataCache.getTags").value);
	if (raw === null) return [];
	const out: Array<{ tag: string; count: number }> = [];
	for (const [tag, count] of Object.entries(raw)) {
		if (tag.length === 0) continue;
		out.push({ tag, count: typeof count === "number" && Number.isFinite(count) ? count : 0 });
	}
	out.sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
	return out;
}

// ----------------------------------------------------------------- bookmarks

export interface UnsafeBookmark {
	title: string;
	path?: string;
}

/** Depth cap doubles as the cycle guard — a group that contains itself stops. */
const BOOKMARK_MAX_DEPTH = 6;
const BOOKMARK_MAX_ITEMS = 500;

function basename(path: string): string {
	const file = path.slice(path.lastIndexOf("/") + 1);
	const dot = file.lastIndexOf(".");
	return dot > 0 ? file.slice(0, dot) : file;
}

function collectBookmarks(entries: unknown, out: UnsafeBookmark[], depth: number): void {
	if (depth > BOOKMARK_MAX_DEPTH) return;
	for (const entry of list(entries)) {
		if (out.length >= BOOKMARK_MAX_ITEMS) return;
		const item = dict(entry);
		if (item === null) continue;
		const children = item["items"];
		if (Array.isArray(children)) {
			// A group is a container, not a target: recurse, do not emit a row.
			collectBookmarks(children, out, depth + 1);
			continue;
		}
		const path = str(item["path"]);
		const title = str(item["title"]) ?? (path === null ? str(item["query"]) : basename(path));
		if (title === null) continue;
		out.push(path === null ? { title } : { title, path });
	}
}

/**
 * Flattened bookmarks of the core plugin. GUESS: the item shape
 * (`{ type, title?, path?, query?, items? }`) is read off the plugin's data
 * file, not off any documented type — hence every field is optional here.
 */
export function getBookmarkItems(app: unknown): UnsafeBookmark[] {
	const instance = internalPluginInstance(app, "bookmarks");
	const call = invoke(instance, "getBookmarks", [], "bookmarks.getBookmarks");
	const roots = Array.isArray(call.value) ? call.value : field(instance, "items");
	const out: UnsafeBookmark[] = [];
	collectBookmarks(roots, out, 0);
	return out;
}

// ------------------------------------------------------------- file explorer

/**
 * Show a path in the file explorer sidebar. `vault.getAbstractFileByPath` is
 * public but resolving it here keeps the whole reveal operation — including
 * the file-explorer instance it feeds — inside the quarantine.
 */
export function revealInFileExplorer(app: unknown, path: string): boolean {
	const file = invoke(
		field(app, "vault"),
		"getAbstractFileByPath",
		[path],
		"vault.getAbstractFileByPath",
	);
	if (!file.ok || file.value === null || file.value === undefined) return false;
	const instance = internalPluginInstance(app, "file-explorer");
	return invoke(instance, "revealInFolder", [file.value], "file-explorer.revealInFolder").ok;
}

// ---------------------------------------------------------------- settings

/**
 * Open the settings window on a specific tab. Two internals in sequence, so a
 * half-working build cannot leave the user staring at a blank settings dialog:
 * the tab switch decides the return value, not the window opening.
 */
export function openSettingsTab(app: unknown, tabId: string): boolean {
	const setting = field(app, "setting");
	if (!hasMethod(setting, "openTabById")) return false;
	if (!invoke(setting, "open", [], "setting.open").ok) return false;
	return invoke(setting, "openTabById", [tabId], "setting.openTabById").ok;
}

/**
 * Every settings page, core and community, so they can be searched like
 * commands. GUESS: core pages live in `setting.settingTabs` and plugin pages
 * in `setting.pluginTabs`, each entry carrying `id` and `name`.
 */
export function listSettingTabs(app: unknown): Array<{ id: string; name: string }> {
	const setting = field(app, "setting");
	const out: Array<{ id: string; name: string }> = [];
	const seen = new Set<string>();
	for (const bucket of ["settingTabs", "pluginTabs"]) {
		for (const entry of list(field(setting, bucket))) {
			const id = str(field(entry, "id"));
			const name = str(field(entry, "name"));
			if (id === null || name === null || seen.has(id)) continue;
			seen.add(id);
			out.push({ id, name });
		}
	}
	return out;
}

// ------------------------------------------------------------------- modal

export interface UnsafeChooser {
	useSelectedItem(ev: Partial<KeyboardEvent>): void;
}

/**
 * SuggestModal's internal chooser — the only way to run the highlighted item
 * from our own key handler. The returned object is a WRAPPER, so even the call
 * a caller makes later cannot throw.
 */
export function getChooser(modal: unknown): UnsafeChooser | null {
	const chooser = field(modal, "chooser");
	if (!hasMethod(chooser, "useSelectedItem")) return null;
	return {
		useSelectedItem(ev: Partial<KeyboardEvent>): void {
			invoke(chooser, "useSelectedItem", [ev], "chooser.useSelectedItem");
		},
	};
}

/**
 * Re-run the modal's own suggestion pipeline after we changed state behind its
 * back (a filter chip, a pushed page). False means the list is now stale and
 * the caller must fall back to nudging the input value.
 */
export function forceUpdateSuggestions(modal: unknown): boolean {
	return invoke(modal, "updateSuggestions", [], "modal.updateSuggestions").ok;
}

// -------------------------------------------------------------- workspace

/**
 * A leaf's internal id, which is what `workspace.getLeafById` (public, @since
 * 1.5.1) takes. Without it a tab row cannot be re-activated, so callers fall
 * back to opening the tab's file in a new leaf.
 */
export function getLeafId(leaf: unknown): string | null {
	return str(field(leaf, "id"));
}

/**
 * Reveal a vault file in the operating system's own file manager.
 *
 * `app.showInFolder` takes a vault-relative path and is undocumented. Desktop
 * only by nature; on mobile it simply is not there, which the guard already
 * handles — the action degrades to a notice instead of vanishing silently.
 */
export function showInSystemFolder(app: unknown, path: string): boolean {
	return invoke(app, "showInFolder", [path], "showInFolder").ok;
}

// -------------------------------------------------------------- search pane

/**
 * Put a query into Obsidian's own search pane.
 *
 * There is no public way to run a vault search. The tempting shortcut —
 * `workspace.openLinkText("tag:x", …)` — is actively harmful: openLinkText
 * resolves a WIKILINK, so an unresolved one creates a note literally named
 * `tag:x` in the user's vault. Reaching the core search plugin is the only
 * correct route, and it degrades to `false` rather than writing anything.
 */
export function openGlobalSearch(app: unknown, query: string): boolean {
	const instance = internalPluginInstance(app, "global-search");
	return invoke(instance, "openGlobalSearch", [query], "global-search:open").ok;
}

// ----------------------------------------------------------- capabilities

/**
 * What is actually present in THIS build. Probed once at load so the plugin
 * can say "commands are unavailable in this Obsidian build" instead of
 * silently showing an empty list.
 *
 * Every probe is a presence check. Nothing here executes an internal that has
 * a side effect (notably not `setting.open`).
 */
export interface UnsafeCapabilities {
	/** Enumerating and executing commands. Without it there is no command bar. */
	commands: boolean;
	/** Hotkey chips on command rows. */
	hotkeys: boolean;
	/** Community plugin gating (`requiresPlugin`). */
	communityPlugins: boolean;
	/** Core plugin gating, pinned commands, bookmarks, reveal in explorer. */
	internalPlugins: boolean;
	/** Vault-wide tag list. */
	vaultTags: boolean;
	/** Searchable settings pages. */
	settings: boolean;
}

export function capabilities(app: unknown): UnsafeCapabilities {
	const registry = commandRegistry(app);
	const setting = field(app, "setting");
	return {
		commands:
			(hasMethod(registry, "listCommands") || dict(field(registry, "commands")) !== null) &&
			hasMethod(registry, "executeCommandById"),
		hotkeys:
			hasMethod(field(app, "hotkeyManager"), "getHotkeys") ||
			hasMethod(field(app, "hotkeyManager"), "getDefaultHotkeys"),
		communityPlugins:
			field(field(app, "plugins"), "enabledPlugins") instanceof Set ||
			Array.isArray(field(field(app, "plugins"), "enabledPlugins")) ||
			dict(field(field(app, "plugins"), "plugins")) !== null,
		internalPlugins:
			hasMethod(internalPluginRegistry(app), "getPluginById") ||
			hasMethod(internalPluginRegistry(app), "getEnabledPluginById") ||
			dict(field(internalPluginRegistry(app), "plugins")) !== null,
		vaultTags: hasMethod(field(app, "metadataCache"), "getTags"),
		settings: hasMethod(setting, "openTabById"),
	};
}

const CAPABILITY_LABELS: Record<keyof UnsafeCapabilities, string> = {
	commands: "Commands",
	hotkeys: "Hotkey chips",
	communityPlugins: "Community plugin detection",
	internalPlugins: "Core plugin detection",
	vaultTags: "Vault tag list",
	settings: "Settings pages",
};

/** Human-readable names of what is missing — for one notice, once, at load. */
export function missingCapabilities(caps: UnsafeCapabilities): string[] {
	const out: string[] = [];
	for (const key of Object.keys(CAPABILITY_LABELS) as Array<keyof UnsafeCapabilities>) {
		if (!caps[key]) out.push(CAPABILITY_LABELS[key]);
	}
	return out;
}
