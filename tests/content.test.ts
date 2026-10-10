import { describe, expect, it } from "vitest";
import { extractExternalLinks, labelForUrl, maskCode } from "../src/index/content";

/** Which URLs in a note become link docs — and where they sit. */
describe("extractExternalLinks", () => {
	const urls = (md: string, ranges: Array<[number, number]> = []) =>
		extractExternalLinks(md, ranges).map((link) => link.url);

	it("keeps balanced parentheses inside markdown and bare URLs", () => {
		expect(urls("[Mercury](https://en.wikipedia.org/wiki/Mercury_(planet)) done")).toEqual([
			"https://en.wikipedia.org/wiki/Mercury_(planet)",
		]);
		expect(urls("see https://en.wikipedia.org/wiki/Mercury_(planet).")).toEqual([
			"https://en.wikipedia.org/wiki/Mercury_(planet)",
		]);
		// A bare URL wrapped in prose parentheses keeps its own closing out.
		expect(urls("(https://example.com/a)")).toEqual(["https://example.com/a"]);
	});

	it("reads link text, skips image embeds and does not double-count", () => {
		const links = extractExternalLinks(
			"[Docs](https://docs.example.com) ![img](https://x.test/a.png) <https://auto.test>",
		);
		expect(links.map((link) => [link.text, link.url])).toEqual([
			["Docs", "https://docs.example.com"],
			["", "https://auto.test"],
		]);
	});

	it("keeps code words in a link title instead of blanking them", () => {
		const links = extractExternalLinks(
			"[`npm ci` docs](https://docs.npmjs.com/cli) and [`foo`](https://foo.test)",
		);
		expect(links.map((link) => [link.text, link.url])).toEqual([
			["npm ci docs", "https://docs.npmjs.com/cli"],
			["foo", "https://foo.test"],
		]);
	});

	it("ignores URLs in inline code and in code blocks", () => {
		const md = "use `curl https://api.test/v1`\n```\nhttps://in.fence\n```\nhttps://real.test";
		const fenceStart = md.indexOf("```\n");
		const fenceEnd = md.indexOf("```\nhttps://real") + 3;
		expect(urls(md, [[fenceStart, fenceEnd]])).toEqual(["https://real.test"]);
	});

	it("keeps offsets and lines of the original note", () => {
		const md = "`x`\nline two https://a.test";
		const [link] = extractExternalLinks(md);
		expect(link?.offset).toBe(md.indexOf("https://"));
		expect(link?.line).toBe(1);
	});
});

describe("maskCode", () => {
	it("blanks code without moving anything", () => {
		const md = "a `b` c\n```\nd\n```";
		const masked = maskCode(md, [[8, md.length]]);
		expect(masked.length).toBe(md.length);
		expect(masked.split("\n").length).toBe(md.split("\n").length);
		expect(masked.startsWith("a     c")).toBe(true);
	});
});

describe("labelForUrl", () => {
	it("is host plus path", () => {
		expect(labelForUrl("https://example.com/a/b?q=1")).toBe("example.com/a/b");
		expect(labelForUrl("not a url")).toBe("not a url");
	});
});
