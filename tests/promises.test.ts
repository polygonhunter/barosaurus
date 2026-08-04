import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * Claim discipline.
 *
 * Every blocker found in the pre-release audit was the same shape: a subsystem
 * was written, tested and merged WITHOUT its entry point, while the README and
 * the settings tab were written to the design rather than to the build. The
 * unit tests all passed, because each half was correct in isolation — only the
 * connection was missing.
 *
 * So this file tests the connections. It is deliberately crude (it greps) and
 * deliberately load-bearing: a setting that nothing reads, or a documented key
 * that nothing registers, fails the build.
 */

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
		else if (entry.endsWith(".ts")) found.push(full);
	}
	return found;
}

/** Strip comments so a symbol merely discussed in prose does not count. */
function code(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const FILES = sourceFiles(SRC);
const SETTINGS_FILE = join(SRC, "settings.ts");
const ALL_CODE = FILES.map((file) => ({ file, text: code(readFileSync(file, "utf8")) }));

/** Where a name appears in code, excluding the file that merely declares it. */
function readersOf(name: string, excluding: string): string[] {
	return ALL_CODE.filter(({ file, text }) => file !== excluding && text.includes(name)).map(
		({ file }) => file.slice(ROOT.length + 1),
	);
}

describe("every setting is actually read", () => {
	// The settings interface is the contract with the user. A switch that
	// nothing reads is a lie the user cannot detect except by trying it.
	const declared = [...readFileSync(SETTINGS_FILE, "utf8").matchAll(/^\t(\w+)[?]?:/gm)]
		.map((match) => match[1])
		.filter((name): name is string => name !== undefined);

	it("finds the settings to check", () => {
		expect(declared.length).toBeGreaterThan(10);
	});

	for (const name of declared) {
		it(`something outside settings.ts reads "${name}"`, () => {
			const readers = readersOf(`.${name}`, SETTINGS_FILE);
			expect(
				readers,
				`settings.${name} has no reader — either wire it up or remove the switch`,
			).not.toEqual([]);
		});
	}
});

describe("every documented key is registered", () => {
	// The README's keyboard table and the bar's own instruction strip both
	// promise these. A promise with no registration is the exact defect this
	// file exists to prevent.
	const modal = ALL_CODE.filter(({ file }) => file.endsWith("omnibar-modal.ts"))
		.map(({ text }) => text)
		.join("\n");

	const BINDINGS: Array<{ key: string; pattern: RegExp; documented: string }> = [
		{ key: "Cmd+K", pattern: /"k"/i, documented: "opens the action panel" },
		{ key: "Cmd+P", pattern: /"p"/i, documented: "pins or unpins" },
		{ key: "Tab", pattern: /"Tab"/, documented: "completes or dives in" },
		{ key: "ArrowUp", pattern: /ArrowUp/, documented: "recalls recent queries" },
		{ key: "Escape", pattern: /Escape/, documented: "goes back one level" },
		{ key: "Backspace", pattern: /Backspace/, documented: "goes back on an empty input" },
	];

	it("found the modal", () => {
		expect(modal.length).toBeGreaterThan(100);
	});

	for (const { key, pattern, documented } of BINDINGS) {
		it(`${key} is bound — the docs say it ${documented}`, () => {
			expect(pattern.test(modal), `${key} is documented but never registered`).toBe(true);
		});
	}
});

describe("no module is written and then left unreachable", () => {
	// Each of these was fully implemented, fully unit-tested, and imported by
	// nothing at the time of the audit. Dead weight in a plugin is not free:
	// it is review surface, bundle size, and a false impression of coverage.
	const MUST_BE_IMPORTED = [
		"core/actions",
		"core/history",
		"core/insert",
		"core/wrap",
		"core/style",
		"core/pagestack",
		"core/editing",
		"core/blocks",
	];

	for (const module of MUST_BE_IMPORTED) {
		it(`${module}.ts is imported by something`, () => {
			const declaring = join(SRC, `${module}.ts`);
			const importers = ALL_CODE.filter(
				({ file, text }) =>
					file !== declaring &&
					// Relative imports resolve to the module's basename.
					new RegExp(`from\\s+["'][^"']*${module.split("/").pop()}["']`).test(text),
			).map(({ file }) => file.slice(ROOT.length + 1));

			expect(
				importers,
				`src/${module}.ts is unreachable — wire it up or delete it`,
			).not.toEqual([]);
		});
	}
});

describe("the index is read, not only written", () => {
	// The whole point of building an index. It was built, OCR'd and persisted
	// for a full milestone without a single reader.
	it("some source queries the full-text index", () => {
		const readers = ALL_CODE.filter(
			({ file, text }) =>
				file.includes(`${"sources"}`) && /search(WithExcludes)?\s*\(/.test(text),
		).map(({ file }) => file.slice(ROOT.length + 1));

		expect(readers, "nothing queries the index — indexing would be pure cost").not.toEqual([]);
	});
});

describe("getting help is reachable from the bar, not only from the settings tab", () => {
	// The same shape as every case above. `supportUrl()` built a contact URL
	// carrying the plugin version, the Obsidian version and the platform;
	// `openSupport()` opened it; and the one caller in the entire plugin was a
	// button in Settings → About. The bar — the thing the user is already
	// looking at when something breaks — had no route to either, and no test
	// could tell, because both halves were correct in isolation.
	const CATALOG_FILE = join(SRC, "core", "catalog.ts");
	const EXECUTE_FILE = join(SRC, "ui", "execute.ts");
	const MAIN_FILE = join(SRC, "main.ts");

	function codeOf(file: string): string {
		return ALL_CODE.find((entry) => entry.file === file)?.text ?? "";
	}

	it("a source offers the help entries", () => {
		const sources = readersOf("HELP_ENTRIES", CATALOG_FILE).filter((file) =>
			file.includes("sources"),
		);
		expect(
			sources,
			"the help entries are in the catalog and no source lists them — the bar cannot show what nothing enumerates",
		).not.toEqual([]);
	});

	it("main.ts registers that source", () => {
		// The ARRAY, not the file. Searching the whole of main.ts for the name
		// is satisfied by the import line alone, which is exactly the state this
		// case is supposed to catch: the source is compiled in, reads as wired
		// to any grep, and is never asked for a single candidate. Verified by
		// deleting the entry from ALL_SOURCES and leaving the import — the file
		// -wide check stayed green.
		const registry = /ALL_SOURCES[^=]*=\s*\[([^\]]*)\]/.exec(codeOf(MAIN_FILE))?.[1] ?? "";
		expect(
			/\bhelpSource\b/.test(registry),
			"the help source exists but ALL_SOURCES does not include it — every test can pass while the bar never asks it anything",
		).toBe(true);
	});

	/**
	 * A raw NUL byte in a source file is invisible in a diff, makes grep report
	 * the file as binary, and got into src/sources/properties.ts by being typed
	 * rather than escaped. The separator itself is fine; writing it literally is
	 * not.
	 */
	it("no source file contains a raw control character", () => {
		const offenders: string[] = [];
		for (const file of FILES) {
			if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(readFileSync(file, "utf8"))) {
				offenders.push(file);
			}
		}
		expect(offenders, `raw control characters in: ${offenders.join(", ")}`).toEqual([]);
	});

	// Same trap, next source. Every source file that exports a `<name>Source`
	// has to appear in the array, or it is dead weight that greps as wired.
	it("main.ts registers every source that exists", () => {
		const registry = /ALL_SOURCES[^=]*=\s*\[([^\]]*)\]/.exec(codeOf(MAIN_FILE))?.[1] ?? "";
		const missing: string[] = [];
		for (const file of readdirSync(join(__dirname, "..", "src", "sources"))) {
			if (!file.endsWith(".ts")) continue;
			const code = readFileSync(join(__dirname, "..", "src", "sources", file), "utf8");
			for (const [, name] of code.matchAll(/export const (\w+Source)\s*:/g)) {
				if (name !== undefined && !new RegExp(`\\b${name}\\b`).test(registry)) missing.push(name);
			}
		}
		expect(
			missing,
			`these sources exist and ALL_SOURCES does not include them: ${missing.join(", ")}`,
		).toEqual([]);
	});

	it("the one dispatcher builds the support URL", () => {
		expect(
			codeOf(EXECUTE_FILE).includes("supportUrl"),
			"runAction has no support case — picking the entry with Enter or from the ⌘K panel would do nothing",
		).toBe(true);
	});

	it("the URL builder has exactly one implementation", () => {
		// Two builders drift, and the second one is always the one that forgets
		// the version — which is the whole reason the link carries it.
		const builders = ALL_CODE.filter(({ text }) => text.includes("#kontakt")).map(({ file }) =>
			file.slice(ROOT.length + 1),
		);
		expect(builders, "the support URL is built in more than one place").toEqual([
			"src/core/catalog.ts",
		]);
	});
});

const UNSAFE_FILE = join(SRC, "ui", "unsafe.ts");

describe("the capability probe is surfaced, not only computed", () => {
	// unsafe.ts probes the undocumented APIs so the plugin can degrade instead
	// of crash. Degrading is its own failure mode though: the user just has one
	// feature less and no way to find out why. docs/findings.md told the tester
	// to read this probe while nothing outside unsafe.ts ever called it — the
	// same missing-connection shape as every other case in this file.
	for (const name of ["capabilities", "missingCapabilities"]) {
		it(`something outside unsafe.ts calls ${name}()`, () => {
			const readers = readersOf(`${name}(`, UNSAFE_FILE);
			expect(
				readers,
				`${name}() is computed but never shown — a missing internal would stay invisible`,
			).not.toEqual([]);
		});
	}
});

describe("internals stay inside the quarantine", () => {
	// The architecture rule: every undocumented API lives behind a narrow
	// accessor in src/ui/unsafe.ts, so there is exactly one file to audit when
	// Obsidian changes. settings.ts once reached around it with its own cast to
	// app.setting, which is how a rule with no test erodes.
	const INTERNALS = [
		"hotkeyManager",
		"internalPlugins",
		"enabledPlugins",
		"updateSuggestions",
		"chooser",
	];

	for (const name of INTERNALS) {
		it(`only unsafe.ts touches ${name}`, () => {
			const offenders = readersOf(name, UNSAFE_FILE);
			expect(
				offenders,
				`${name} is an undocumented API — route it through src/ui/unsafe.ts`,
			).toEqual([]);
		});
	}
});

describe("no accessor shadows a member Obsidian owns", () => {
	// The bar could not open at all, on the very first launch: Modal assigns a
	// `win` field to the instance at runtime, that field is absent from the
	// typings so neither tsc nor the store linter could see it, and our
	// getter-only `get win()` on the prototype turned Modal's own assignment
	// into "Cannot set property win of #<OmnibarModal> which has only a getter"
	// — thrown inside the constructor, before anything rendered.
	//
	// A getter that merely READS is not the danger. Owning the NAME is.
	const RESERVED = [
		// Modal
		"app",
		"scope",
		"containerEl",
		"modalEl",
		"titleEl",
		"contentEl",
		// SuggestModal
		"limit",
		"emptyStateText",
		"inputEl",
		"resultContainerEl",
		// Assigned at runtime, documented nowhere — the ones that bite.
		"win",
		"doc",
		"chooser",
	];

	const UI_DIR = join(SRC, "ui");
	const ui = ALL_CODE.filter(({ file }) => file.startsWith(UI_DIR));

	it("found the ui files to check", () => {
		expect(ui.length).toBeGreaterThan(5);
	});

	for (const name of RESERVED) {
		it(`nothing in src/ui declares "get ${name}()"`, () => {
			const pattern = new RegExp(`\\bget\\s+${name}\\s*\\(`);
			const offenders = ui
				.filter(({ text }) => pattern.test(text))
				.map(({ file }) => file.slice(ROOT.length + 1));

			expect(
				offenders,
				`get ${name}() shadows a member Obsidian assigns to on its own instances — rename it`,
			).toEqual([]);
		});
	}
});
