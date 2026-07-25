import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	capabilities,
	executeCommandById,
	findCommand,
	forceUpdateSuggestions,
	getAllVaultTags,
	getBookmarkItems,
	getChooser,
	getEnabledPluginIds,
	getHotkeyChip,
	getLeafId,
	getPinnedCommandIds,
	isCorePluginEnabled,
	listCommands,
	listSettingTabs,
	missingCapabilities,
	openSettingsTab,
	resetUnsafeReports,
	revealInFileExplorer,
} from "../src/ui/unsafe";

/**
 * The quarantine's whole promise is "never throws, always degrades". These
 * tests are written against FAKE apps — plain object literals with fields
 * missing, null, or of the wrong type — because that is exactly what a future
 * Obsidian build looks like from in here. The file under test imports
 * `obsidian` only as a type, so this suite needs no shim.
 */

beforeEach(() => {
	resetUnsafeReports();
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	// Hotkey chips read the user agent; pin it so the suite is deterministic.
	vi.stubGlobal("navigator", { platform: "Win32", userAgent: "Windows NT" });
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

/** Apps that are broken in every way we can think of. */
const HOSTILE_APPS: unknown[] = [
	undefined,
	null,
	0,
	42,
	"",
	"app",
	true,
	[],
	{},
	Object.create(null) as unknown,
	() => undefined,
	{ commands: null },
	{ commands: 42 },
	{ commands: [] },
	{ commands: { listCommands: null, commands: null } },
	{ commands: { listCommands: "nope", executeCommandById: 7 } },
	{
		commands: {
			listCommands: () => {
				throw new Error("boom");
			},
			findCommand: () => {
				throw new Error("boom");
			},
			executeCommandById: () => {
				throw new Error("boom");
			},
		},
	},
	{ commands: { listCommands: () => "not an array" } },
	{ hotkeyManager: "nope" },
	{ hotkeyManager: { getHotkeys: () => ({ nope: true }) } },
	{
		hotkeyManager: {
			getHotkeys: () => {
				throw new Error("boom");
			},
		},
	},
	{ internalPlugins: 0 },
	{ internalPlugins: { getPluginById: () => null } },
	{ internalPlugins: { getPluginById: () => ({ instance: null }) } },
	{
		internalPlugins: {
			getPluginById: (id: string) =>
				id === "command-palette" ? { instance: { options: { pinned: [1, null] } } } : null,
		},
	},
	{ internalPlugins: { plugins: { bookmarks: "nope" } } },
	{ plugins: { enabledPlugins: "not a set" } },
	{ plugins: { enabledPlugins: null, plugins: null } },
	{ metadataCache: null },
	{ metadataCache: { getTags: () => null } },
	{ metadataCache: { getTags: () => "nope" } },
	{ vault: { getAbstractFileByPath: () => null } },
	{ setting: {} },
	{ setting: { settingTabs: [null, 3, {}, { id: 4 }], pluginTabs: "x" } },
];

describe("unsafe accessors degrade instead of throwing", () => {
	for (const [index, app] of HOSTILE_APPS.entries()) {
		it(`survives hostile app #${index}`, () => {
			expect(listCommands(app)).toEqual([]);
			expect(findCommand(app, "any:id")).toBeNull();
			expect(executeCommandById(app, "any:id")).toBe(false);
			expect(getHotkeyChip(app, "any:id")).toBeNull();
			expect(getPinnedCommandIds(app)).toEqual([]);
			expect(getEnabledPluginIds(app)).toBeInstanceOf(Set);
			expect(getEnabledPluginIds(app).size).toBe(0);
			expect(isCorePluginEnabled(app, "bookmarks")).toBe(false);
			expect(getAllVaultTags(app)).toEqual([]);
			expect(getBookmarkItems(app)).toEqual([]);
			expect(revealInFileExplorer(app, "a.md")).toBe(false);
			expect(openSettingsTab(app, "barosaurus")).toBe(false);
			expect(listSettingTabs(app)).toEqual([]);
			expect(getChooser(app)).toBeNull();
			expect(forceUpdateSuggestions(app)).toBe(false);
			expect(getLeafId(app)).toBeNull();
			expect(() => capabilities(app)).not.toThrow();
		});
	}
});

describe("listCommands", () => {
	it("keeps only entries that carry a string id and name", () => {
		const app = {
			commands: {
				listCommands: () => [
					{ id: "editor:toggle-bold", name: "Toggle bold" },
					null,
					42,
					{ id: 5, name: "wrong type" },
					{ name: "no id" },
					{ id: "no:name" },
					{ id: "app:go-back", name: "Navigate back" },
				],
			},
		};
		expect(listCommands(app).map((c) => c.id)).toEqual(["editor:toggle-bold", "app:go-back"]);
	});

	it("falls back to the raw commands record when listCommands is gone", () => {
		const app = {
			commands: {
				commands: {
					"editor:toggle-bold": { id: "editor:toggle-bold", name: "Toggle bold" },
					broken: null,
				},
			},
		};
		expect(listCommands(app).map((c) => c.name)).toEqual(["Toggle bold"]);
	});

	it("reports a throwing internal exactly once", () => {
		const app = {
			commands: {
				listCommands: () => {
					throw new Error("boom");
				},
			},
		};
		listCommands(app);
		listCommands(app);
		listCommands(app);
		expect(console.error).toHaveBeenCalledTimes(1);
	});
});

describe("findCommand", () => {
	it("uses findCommand when present", () => {
		const app = { commands: { findCommand: (id: string) => ({ id, name: `Name of ${id}` }) } };
		expect(findCommand(app, "x:y")?.name).toBe("Name of x:y");
	});

	it("falls back to the record and rejects malformed entries", () => {
		const app = {
			commands: { commands: { "a:b": { id: "a:b", name: "AB" }, "c:d": { id: "c:d" } } },
		};
		expect(findCommand(app, "a:b")?.name).toBe("AB");
		expect(findCommand(app, "c:d")).toBeNull();
		expect(findCommand(app, "missing")).toBeNull();
	});
});

describe("executeCommandById", () => {
	it("is false when the command reports it did not run", () => {
		expect(executeCommandById({ commands: { executeCommandById: () => false } }, "x")).toBe(false);
	});

	it("is true when the command ran", () => {
		expect(executeCommandById({ commands: { executeCommandById: () => true } }, "x")).toBe(true);
	});

	it("treats a void return as executed — the documented guess", () => {
		expect(executeCommandById({ commands: { executeCommandById: () => undefined } }, "x")).toBe(
			true,
		);
	});

	it("is false when the command throws", () => {
		const app = {
			commands: {
				executeCommandById: () => {
					throw new Error("boom");
				},
			},
		};
		expect(executeCommandById(app, "x")).toBe(false);
	});
});

describe("getHotkeyChip", () => {
	const manager = (custom: unknown, defaults: unknown) => ({
		hotkeyManager: { getHotkeys: () => custom, getDefaultHotkeys: () => defaults },
	});

	it("prefers the customized hotkey", () => {
		const app = manager(
			[{ modifiers: ["Mod", "Shift"], key: "p" }],
			[{ modifiers: ["Mod"], key: "k" }],
		);
		expect(getHotkeyChip(app, "x")).toBe("Ctrl+Shift+P");
	});

	it("falls back to the default hotkey when none is customized", () => {
		expect(getHotkeyChip(manager(undefined, [{ modifiers: ["Alt"], key: "ArrowUp" }]), "x")).toBe(
			"Alt+↑",
		);
	});

	it("honours an EMPTY custom list as 'the user removed it'", () => {
		expect(getHotkeyChip(manager([], [{ modifiers: ["Mod"], key: "k" }]), "x")).toBeNull();
	});

	it("uses mac symbols on an apple keyboard", () => {
		vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Macintosh" });
		expect(getHotkeyChip(manager([{ modifiers: ["Mod", "Alt"], key: "k" }], undefined), "x")).toBe(
			"⌘⌥K",
		);
	});

	it("ignores malformed hotkey entries", () => {
		expect(getHotkeyChip(manager([{ modifiers: "nope" }, null], undefined), "x")).toBeNull();
		expect(getHotkeyChip(manager([{ modifiers: "nope", key: "k" }], undefined), "x")).toBe("K");
	});
});

describe("getPinnedCommandIds", () => {
	it("reads the command-palette instance options", () => {
		const app = {
			internalPlugins: {
				getPluginById: (id: string) =>
					id === "command-palette"
						? { instance: { options: { pinned: ["a:b", null, 7, "c:d"] } } }
						: null,
			},
		};
		expect(getPinnedCommandIds(app)).toEqual(["a:b", "c:d"]);
	});

	it("falls back to the plugins table", () => {
		const app = {
			internalPlugins: {
				plugins: { "command-palette": { instance: { options: { pinned: ["x:y"] } } } },
			},
		};
		expect(getPinnedCommandIds(app)).toEqual(["x:y"]);
	});
});

describe("getEnabledPluginIds", () => {
	it("reads a real Set", () => {
		const app = { plugins: { enabledPlugins: new Set(["dataview", "templater"]) } };
		expect([...getEnabledPluginIds(app)].sort()).toEqual(["dataview", "templater"]);
	});

	it("accepts an array, because a serialized Set is a plausible future shape", () => {
		expect([...getEnabledPluginIds({ plugins: { enabledPlugins: ["a", 1, null, "b"] } })]).toEqual([
			"a",
			"b",
		]);
	});

	it("falls back to the loaded-instance table", () => {
		const app = { plugins: { plugins: { dataview: {}, dead: null } } };
		expect([...getEnabledPluginIds(app)]).toEqual(["dataview"]);
	});
});

describe("isCorePluginEnabled", () => {
	it("trusts getEnabledPluginById when it exists", () => {
		const app = {
			internalPlugins: { getEnabledPluginById: (id: string) => (id === "bookmarks" ? {} : null) },
		};
		expect(isCorePluginEnabled(app, "bookmarks")).toBe(true);
		expect(isCorePluginEnabled(app, "canvas")).toBe(false);
	});

	it("falls back to the entry's enabled flag", () => {
		const app = {
			internalPlugins: {
				getPluginById: (id: string) => ({ enabled: id === "bookmarks", instance: {} }),
			},
		};
		expect(isCorePluginEnabled(app, "bookmarks")).toBe(true);
		expect(isCorePluginEnabled(app, "graph")).toBe(false);
	});

	it("falls back to the presence of an instance", () => {
		const app = { internalPlugins: { plugins: { bookmarks: { instance: {} }, graph: {} } } };
		expect(isCorePluginEnabled(app, "bookmarks")).toBe(true);
		expect(isCorePluginEnabled(app, "graph")).toBe(false);
	});
});

describe("getAllVaultTags", () => {
	it("sorts by count and repairs non-numeric counts", () => {
		const app = { metadataCache: { getTags: () => ({ "#a": 2, "#b": 9, "#c": "lots" }) } };
		expect(getAllVaultTags(app)).toEqual([
			{ tag: "#b", count: 9 },
			{ tag: "#a", count: 2 },
			{ tag: "#c", count: 0 },
		]);
	});
});

describe("getBookmarkItems", () => {
	it("flattens groups and derives a title from the path", () => {
		const app = {
			internalPlugins: {
				getPluginById: () => ({
					instance: {
						getBookmarks: () => [
							{ type: "file", path: "Notes/Mira Holt.md" },
							{ type: "group", title: "Work", items: [{ type: "file", path: "Work/Plan.md" }] },
							{ type: "search", query: "tag:#todo", title: "Todos" },
							null,
						],
					},
				}),
			},
		};
		expect(getBookmarkItems(app)).toEqual([
			{ title: "Mira Holt", path: "Notes/Mira Holt.md" },
			{ title: "Plan", path: "Work/Plan.md" },
			{ title: "Todos" },
		]);
	});

	it("does not hang on a group that contains itself", () => {
		const loop: { items: unknown[] } = { items: [] };
		loop.items.push(loop);
		const app = { internalPlugins: { getPluginById: () => ({ instance: { items: [loop] } }) } };
		expect(getBookmarkItems(app)).toEqual([]);
	});
});

describe("revealInFileExplorer", () => {
	it("needs both the file and the explorer instance", () => {
		const file = { path: "a.md" };
		const revealed: unknown[] = [];
		const app = {
			vault: { getAbstractFileByPath: () => file },
			internalPlugins: {
				getPluginById: (id: string) =>
					id === "file-explorer"
						? { instance: { revealInFolder: (f: unknown) => revealed.push(f) } }
						: null,
			},
		};
		expect(revealInFileExplorer(app, "a.md")).toBe(true);
		expect(revealed).toEqual([file]);
		expect(revealInFileExplorer({ vault: { getAbstractFileByPath: () => file } }, "a.md")).toBe(
			false,
		);
	});
});

describe("settings", () => {
	it("opens the window only when the tab switch exists", () => {
		const calls: string[] = [];
		const app = {
			setting: {
				open: () => calls.push("open"),
				openTabById: (id: string) => calls.push(`tab:${id}`),
			},
		};
		expect(openSettingsTab(app, "barosaurus")).toBe(true);
		expect(calls).toEqual(["open", "tab:barosaurus"]);
		expect(openSettingsTab({ setting: { open: () => calls.push("open") } }, "x")).toBe(false);
	});

	it("lists core and plugin tabs, deduplicated", () => {
		const app = {
			setting: {
				settingTabs: [{ id: "editor", name: "Editor" }, { id: "files", name: "Files" }, null],
				pluginTabs: [
					{ id: "barosaurus", name: "Barosaurus" },
					{ id: "editor", name: "Duplicate" },
					{ name: "No id" },
				],
			},
		};
		expect(listSettingTabs(app)).toEqual([
			{ id: "editor", name: "Editor" },
			{ id: "files", name: "Files" },
			{ id: "barosaurus", name: "Barosaurus" },
		]);
	});
});

describe("modal internals", () => {
	it("wraps the chooser so a later call cannot throw either", () => {
		const modal = {
			chooser: {
				useSelectedItem: () => {
					throw new Error("boom");
				},
			},
		};
		const chooser = getChooser(modal);
		expect(chooser).not.toBeNull();
		expect(() => chooser?.useSelectedItem({ key: "Enter" })).not.toThrow();
	});

	it("passes the event through to the real chooser", () => {
		const seen: unknown[] = [];
		const modal = { chooser: { useSelectedItem: (ev: unknown) => seen.push(ev) } };
		getChooser(modal)?.useSelectedItem({ key: "Enter" });
		expect(seen).toEqual([{ key: "Enter" }]);
	});

	it("reports whether the suggestion refresh actually happened", () => {
		let ran = 0;
		expect(forceUpdateSuggestions({ updateSuggestions: () => (ran += 1) })).toBe(true);
		expect(ran).toBe(1);
		expect(forceUpdateSuggestions({ updateSuggestions: 42 })).toBe(false);
		expect(
			forceUpdateSuggestions({
				updateSuggestions: () => {
					throw new Error("boom");
				},
			}),
		).toBe(false);
	});

	it("finds a prototype method, not just an own property", () => {
		class FakeModal {
			calls = 0;
			updateSuggestions(): void {
				this.calls += 1;
			}
		}
		const modal = new FakeModal();
		expect(forceUpdateSuggestions(modal)).toBe(true);
		expect(modal.calls).toBe(1);
	});
});

describe("getLeafId", () => {
	it("reads the internal id and rejects anything else", () => {
		expect(getLeafId({ id: "abc123" })).toBe("abc123");
		expect(getLeafId({ id: 7 })).toBeNull();
		expect(getLeafId({})).toBeNull();
	});
});

describe("capabilities", () => {
	it("reports everything missing on an empty app", () => {
		const caps = capabilities({});
		expect(Object.values(caps).every((value) => value === false)).toBe(true);
		expect(missingCapabilities(caps)).toHaveLength(Object.keys(caps).length);
	});

	it("reports everything present on a complete app", () => {
		const app = {
			commands: { listCommands: () => [], executeCommandById: () => true },
			hotkeyManager: { getHotkeys: () => [], getDefaultHotkeys: () => [] },
			plugins: { enabledPlugins: new Set<string>() },
			internalPlugins: { getPluginById: () => null },
			metadataCache: { getTags: () => ({}) },
			setting: { open: () => undefined, openTabById: () => undefined },
		};
		expect(capabilities(app)).toEqual({
			commands: true,
			hotkeys: true,
			communityPlugins: true,
			internalPlugins: true,
			vaultTags: true,
			settings: true,
		});
		expect(missingCapabilities(capabilities(app))).toEqual([]);
	});

	it("names what is missing, in a form a notice can show", () => {
		const app = { commands: { listCommands: () => [], executeCommandById: () => true } };
		expect(missingCapabilities(capabilities(app))).toEqual([
			"Hotkey chips",
			"Community plugin detection",
			"Core plugin detection",
			"Vault tag list",
			"Settings pages",
		]);
	});

	it("never executes a side-effecting internal while probing", () => {
		let opened = 0;
		const app = {
			setting: { open: () => (opened += 1), openTabById: () => undefined },
			commands: {
				listCommands: () => {
					throw new Error("probing must not call this");
				},
			},
		};
		expect(() => capabilities(app)).not.toThrow();
		expect(opened).toBe(0);
	});
});
