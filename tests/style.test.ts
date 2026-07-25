import { describe, expect, it } from "vitest";
import {
	applyAlignment,
	applyBackground,
	applyForeground,
	backgroundValue,
	COLOR_NAMES,
	containsMarkdownSyntax,
	foregroundValue,
	unwrapAlignment,
	unwrapBackground,
	unwrapForeground,
} from "../src/core/style";

const RED_SPAN = '<span style="color: var(--color-red);">text</span>';
const RED_MARK = '<mark style="background: rgba(var(--color-red-rgb), 0.2);">text</mark>';
const CENTER_DIV = '<div style="text-align: center;">\ntext\n</div>';

/** Editing Toolbar writes these; we only recognise them, we never emit them. */
const LEGACY_FONT = '<font color="#fff">text</font>';
const LEGACY_MARK = '<mark style="background:#fff">text</mark>';
const LEGACY_ALIGN = '<p align="center">text</p>';

describe("colour values", () => {
	it("emits a theme variable by default so the colour survives a theme flip", () => {
		expect(foregroundValue("red", "theme")).toBe("var(--color-red)");
		expect(backgroundValue("red", "theme")).toBe("rgba(var(--color-red-rgb), 0.2)");
	});

	it("emits Obsidian's documented hex values in hex mode", () => {
		expect(foregroundValue("red", "hex")).toBe("#e93147");
		expect(backgroundValue("red", "hex")).toBe("rgba(233, 49, 71, 0.2)");
	});

	it("covers all eight extended colours in both modes", () => {
		expect(COLOR_NAMES).toHaveLength(8);
		for (const color of COLOR_NAMES) {
			expect(foregroundValue(color, "theme"), color).toBe(`var(--color-${color})`);
			expect(foregroundValue(color, "hex"), color).toMatch(/^#[0-9a-f]{6}$/);
			expect(backgroundValue(color, "theme"), color).toBe(`rgba(var(--color-${color}-rgb), 0.2)`);
			expect(backgroundValue(color, "hex"), color).toMatch(/^rgba\(\d+, \d+, \d+, 0\.2\)$/);
		}
	});
});

describe("applyForeground", () => {
	it("wraps with the documented span markup", () => {
		expect(applyForeground("text", "red", "theme")).toBe(RED_SPAN);
	});

	it("uses the hex value in hex mode", () => {
		expect(applyForeground("text", "red", "hex")).toBe(
			'<span style="color: #e93147;">text</span>',
		);
	});

	it("toggles: the SAME colour applied twice removes the wrapper", () => {
		expect(applyForeground(RED_SPAN, "red", "theme")).toBe("text");
		expect(applyForeground(applyForeground("text", "blue", "hex"), "blue", "hex")).toBe("text");
	});

	it("replaces rather than nests when the colour differs", () => {
		expect(applyForeground(RED_SPAN, "blue", "theme")).toBe(
			'<span style="color: var(--color-blue);">text</span>',
		);
	});

	it("switches between theme and hex without nesting", () => {
		expect(applyForeground(RED_SPAN, "red", "hex")).toBe(
			'<span style="color: #e93147;">text</span>',
		);
	});

	it("recognises the legacy <font> markup instead of double-wrapping it", () => {
		expect(applyForeground(LEGACY_FONT, "red", "theme")).toBe(RED_SPAN);
		expect(applyForeground(LEGACY_FONT, "red", "theme")).not.toContain("<font");
	});

	it("wraps an empty selection rather than returning nothing", () => {
		expect(applyForeground("", "green", "theme")).toBe(
			'<span style="color: var(--color-green);"></span>',
		);
	});
});

describe("applyBackground", () => {
	it("wraps with a translucent mark", () => {
		expect(applyBackground("text", "red", "theme")).toBe(RED_MARK);
	});

	it("uses the hex rgb triple in hex mode", () => {
		expect(applyBackground("text", "red", "hex")).toBe(
			'<mark style="background: rgba(233, 49, 71, 0.2);">text</mark>',
		);
	});

	it("toggles the same colour off", () => {
		expect(applyBackground(RED_MARK, "red", "theme")).toBe("text");
		expect(applyBackground(applyBackground("text", "cyan", "hex"), "cyan", "hex")).toBe("text");
	});

	it("replaces rather than nests when the colour differs", () => {
		expect(applyBackground(RED_MARK, "blue", "theme")).toBe(
			'<mark style="background: rgba(var(--color-blue-rgb), 0.2);">text</mark>',
		);
	});

	it("recognises the legacy <mark style=\"background:#fff\"> markup", () => {
		expect(applyBackground(LEGACY_MARK, "red", "theme")).toBe(RED_MARK);
		expect(applyBackground(LEGACY_MARK, "red", "theme")).not.toContain("#fff");
	});
});

describe("unwrapping", () => {
	it("returns null when there is nothing to unwrap", () => {
		expect(unwrapForeground("plain text")).toBeNull();
		expect(unwrapBackground("plain text")).toBeNull();
		expect(unwrapAlignment("plain text")).toBeNull();
	});

	it("strips our own wrappers", () => {
		expect(unwrapForeground(RED_SPAN)).toBe("text");
		// NOTE: in THEME mode this currently succeeds through the legacy <mark>
		// pattern — OURS_BACKGROUND_RE's `rgba\([^)]*\)` stops at the inner
		// `var(…)` paren and never matches our own output. Keep both patterns.
		expect(unwrapBackground(RED_MARK)).toBe("text");
		expect(unwrapBackground('<mark style="background: rgba(233, 49, 71, 0.2);">text</mark>')).toBe(
			"text",
		);
		expect(unwrapAlignment(CENTER_DIV)).toBe("text");
	});

	it("strips the legacy wrappers", () => {
		expect(unwrapForeground(LEGACY_FONT)).toBe("text");
		expect(unwrapBackground(LEGACY_MARK)).toBe("text");
		expect(unwrapAlignment(LEGACY_ALIGN)).toBe("text");
	});

	it("tolerates surrounding whitespace", () => {
		expect(unwrapForeground(`  ${RED_SPAN}  `)).toBe("text");
	});

	it("keeps multi-line content intact", () => {
		const multi = '<div style="text-align: right;">\nline one\nline two\n</div>';
		expect(unwrapAlignment(multi)).toBe("line one\nline two");
	});
});

describe("applyAlignment", () => {
	it("wraps in a div on its own lines", () => {
		expect(applyAlignment("text", "center")).toBe(CENTER_DIV);
		expect(applyAlignment("text", "right")).toBe('<div style="text-align: right;">\ntext\n</div>');
		expect(applyAlignment("text", "justify")).toBe(
			'<div style="text-align: justify;">\ntext\n</div>',
		);
	});

	it("returns the text UNWRAPPED for left, because left is the default", () => {
		expect(applyAlignment("text", "left")).toBe("text");
		expect(applyAlignment(CENTER_DIV, "left")).toBe("text");
	});

	it("toggles the same alignment off", () => {
		expect(applyAlignment(CENTER_DIV, "center")).toBe("text");
	});

	it("replaces a different alignment rather than nesting", () => {
		expect(applyAlignment(CENTER_DIV, "right")).toBe(
			'<div style="text-align: right;">\ntext\n</div>',
		);
	});

	it("recognises the legacy <p align> markup", () => {
		expect(applyAlignment(LEGACY_ALIGN, "center")).toBe(CENTER_DIV);
		expect(applyAlignment(LEGACY_ALIGN, "left")).toBe("text");
	});

	it("aligns a multi-paragraph selection as ONE block", () => {
		const wrapped = applyAlignment("first\n\nsecond", "center");
		expect(wrapped).toBe('<div style="text-align: center;">\nfirst\n\nsecond\n</div>');
		expect(wrapped.split("<div")).toHaveLength(2);
	});
});

describe("containsMarkdownSyntax", () => {
	const POSITIVE: Array<[string, string]> = [
		["bold", "**bold**"],
		["underscore bold", "__bold__"],
		["highlight", "==highlight=="],
		["strikethrough", "~~gone~~"],
		["inline code", "`code`"],
		["bullet list", "- item"],
		["star list", "* item"],
		["plus list", "+ item"],
		["indented list", "  - item"],
		["heading", "# Title"],
		["deep heading", "###### Title"],
		["wikilink", "See [[Another note]]"],
		["syntax on a later line", "plain first line\n- then a list"],
	];

	for (const [label, sample] of POSITIVE) {
		it(`detects ${label}`, () => {
			expect(containsMarkdownSyntax(sample), sample).toBe(true);
		});
	}

	it("is false for plain prose", () => {
		expect(containsMarkdownSyntax("Just a sentence about design tokens.")).toBe(false);
		expect(containsMarkdownSyntax("")).toBe(false);
		expect(containsMarkdownSyntax("A dash - inside a sentence is fine")).toBe(false);
		expect(containsMarkdownSyntax("#tag is not a heading")).toBe(false);
	});
});
