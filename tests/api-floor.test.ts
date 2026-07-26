import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * The typecheck cannot protect our API floor: it runs against the npm typings,
 * which describe the 1.13.x insider surface, while manifest.json promises
 * 1.12.4. Using anything newer passes tsc and then fails the community-plugin
 * linter. So we grep instead.
 */

const SRC = join(__dirname, "..", "src");

/** Symbols introduced in Obsidian 1.13.0+ — unusable at minAppVersion 1.12.4. */
const FORBIDDEN_SYMBOLS = [
	"getSettingDefinitions",
	"SettingDefinitionItem",
	"SettingDefinition",
	"SettingGroup",
	"SettingPage",
	"refreshDomState",
	"getControlValue",
	"setControlValue",
	"settingItems",
	"setErrorMessage",
	"addDisplayValue",
	"errorEl",
	"ConfirmationModal",
	// Both are what the community-plugin linter actively RECOMMENDS as the
	// replacement for a deprecated call we make (`setWarning`,
	// `setDynamicTooltip`). Taking that advice would satisfy one warning and
	// fail the floor check outright, so they are named here to make the trap
	// fail loudly instead of looking like a tidy-up.
	"setDestructive",
	"setDisplayFormat",
];

/** Removed from the API in 1.7.2 — these do not exist in any current build. */
const REMOVED_SYMBOLS = ["prepareQuery", "fuzzySearch", "PreparedQuery"];

/** Typo traps: the real member is singular / differently named. */
const MISSPELLINGS: Array<{ wrong: string; right: string }> = [
	{ wrong: "onNoSuggestions", right: "onNoSuggestion" },
	{ wrong: "Keymap.getModifiers", right: "app.lastEvent + Keymap.isModifier" },
	{ wrong: "scrollIntoViewIfNeeded", right: 'scrollIntoView({ block: "nearest" })' },
	{ wrong: 'metadataCache.on("delete"', right: 'metadataCache.on("deleted"' },
];

function sourceFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
		else if (entry.endsWith(".ts")) found.push(full);
	}
	return found;
}

function read(file: string): string {
	return readFileSync(file, "utf8");
}

/** Strip comments so a symbol named in an explanatory note doesn't fail us. */
function code(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("Obsidian API floor (minAppVersion 1.12.4)", () => {
	const files = sourceFiles(SRC);

	it("finds source files to check", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const symbol of FORBIDDEN_SYMBOLS) {
		it(`never uses ${symbol} (added in 1.13.0+)`, () => {
			const offenders = files.filter((f) => code(read(f)).includes(symbol));
			expect(offenders, `${symbol} found in: ${offenders.join(", ")}`).toEqual([]);
		});
	}

	for (const symbol of REMOVED_SYMBOLS) {
		it(`never uses ${symbol} (removed from the API in 1.7.2)`, () => {
			const offenders = files.filter((f) => code(read(f)).includes(symbol));
			expect(offenders, `${symbol} found in: ${offenders.join(", ")}`).toEqual([]);
		});
	}

	for (const { wrong, right } of MISSPELLINGS) {
		it(`never writes ${wrong} — the real thing is ${right}`, () => {
			const offenders = files.filter((f) => code(read(f)).includes(wrong));
			expect(offenders, `${wrong} found in: ${offenders.join(", ")}`).toEqual([]);
		});
	}
});

describe("core purity", () => {
	it("src/core never imports obsidian", () => {
		const coreDir = join(SRC, "core");
		let coreFiles: string[];
		try {
			coreFiles = sourceFiles(coreDir);
		} catch {
			return; // core/ does not exist yet
		}
		const offenders = coreFiles.filter((f) => /from\s+["']obsidian["']/.test(read(f)));
		expect(
			offenders,
			`core must stay obsidian-free so tests need no shim; found in: ${offenders.join(", ")}`,
		).toEqual([]);
	});
});

describe("DOM hygiene", () => {
	it("never assigns innerHTML", () => {
		const offenders = sourceFiles(SRC).filter((f) => /\.innerHTML\s*=/.test(code(read(f))));
		expect(offenders, `innerHTML assignment found in: ${offenders.join(", ")}`).toEqual([]);
	});
});
