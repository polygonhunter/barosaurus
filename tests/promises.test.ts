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
