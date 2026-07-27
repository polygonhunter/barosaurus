import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * The store rejects a release on rules no local tool checks. `npm run lint`
 * runs eslint over `src/**\/*.ts` only, so manifest.json is never read by it,
 * and eslint-plugin-obsidianmd does not carry these rules at all — they live in
 * Obsidian's own review bot, which we cannot run. 1.0.2 was rejected for a word
 * in the description that had been introduced one release earlier and reviewed
 * by nobody. So we assert them here, in the same read-and-check style as
 * api-floor.test.ts.
 */

const ROOT = join(__dirname, "..");

const read = (name: string): Record<string, unknown> =>
	JSON.parse(readFileSync(join(ROOT, name), "utf8")) as Record<string, unknown>;

const manifest = read("manifest.json");
const pkg = read("package.json");
const versions = read("versions.json");

const description = manifest.description as string;

describe("manifest description", () => {
	it("is present and within the 250 character limit", () => {
		expect(description).toBeTruthy();
		expect(description.length).toBeLessThanOrEqual(250);
	});

	// The rule that rejected 1.0.2, quoted from the review: "The word 'Obsidian'
	// in the description is redundant. It is implied by the context of the
	// plugin directory."
	it("does not name Obsidian", () => {
		expect(description).not.toMatch(/obsidian/i);
	});

	// Not yet observed against us. Listed because it is the same redundancy
	// argument as the rule above, and costs nothing to honour.
	it("does not call itself a plugin", () => {
		expect(description).not.toMatch(/\bplugins?\b/i);
	});

	it("ends with a period", () => {
		expect(description.trimEnd().endsWith(".")).toBe(true);
	});

	it("carries no emoji", () => {
		expect(description).not.toMatch(/\p{Extended_Pictographic}/u);
	});

	// "Avoid starting your description with 'This is a plugin', because it'll be
	// obvious to users in the context of the Community Plugins directory."
	it("does not open by announcing itself", () => {
		expect(description).not.toMatch(/^\s*(this is a|this|an?)\s+plugin\b/i);
	});
});

describe("version bookkeeping", () => {
	// CLAUDE.md requires the bump to land in all three files in one commit.
	// Until now that was checked by hand on every release.
	it("agrees across manifest, package and versions", () => {
		expect(pkg.version).toBe(manifest.version);
		expect(Object.keys(versions)).toContain(manifest.version as string);
	});

	it("records the manifest's own minAppVersion for this release", () => {
		expect(versions[manifest.version as string]).toBe(manifest.minAppVersion);
	});
});
