/**
 * A tiny date formatter with Moment-compatible tokens.
 *
 * It exists for one reason: `moment` must never be bundled and must never be
 * an esbuild external. Marking it external crashes the plugin at load with
 * "Cannot find module 'moment'"; bundling it drags in a deprecated 300 KB
 * dependency for what amounts to five string replacements. Slashosaurus hit
 * exactly this and removed moment for the same reason.
 *
 * Supported tokens: YYYY YY MMMM MMM MM M dddd ddd DD D HH H hh h mm m ss s
 * A a. Literal text goes in [brackets], so "[Week of ]YYYY" works.
 *
 * Deliberately English-only and locale-free: the output is written INTO the
 * user's note, so it has to be the same string on every machine that syncs the
 * vault. `toLocaleDateString()` would silently differ between devices.
 */

const MONTHS: readonly string[] = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

const WEEKDAYS: readonly string[] = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

/**
 * Longest token first — otherwise "YYYY" is eaten as two "YY" and "MMMM" as
 * two "MM". The bracket branch comes first so a literal never gets scanned.
 */
const TOKEN_RE = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|H|hh|h|mm|m|ss|s|A|a/g;

/** What the settings tab offers when the field is emptied. */
export const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

export function formatDate(date: Date, format: string): string {
	// An unusable Date would otherwise print "NaN-NaN-NaN" into the note.
	if (Number.isNaN(date.getTime())) return "";
	return format.replace(TOKEN_RE, (token: string, literal: string | undefined) => {
		if (literal !== undefined) return literal;
		const hours24 = date.getHours();
		const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
		switch (token) {
			case "YYYY":
				return String(date.getFullYear());
			case "YY":
				return pad(date.getFullYear() % 100);
			case "MMMM":
				return MONTHS[date.getMonth()] ?? "";
			case "MMM":
				return (MONTHS[date.getMonth()] ?? "").slice(0, 3);
			case "MM":
				return pad(date.getMonth() + 1);
			case "M":
				return String(date.getMonth() + 1);
			case "dddd":
				return WEEKDAYS[date.getDay()] ?? "";
			case "ddd":
				return (WEEKDAYS[date.getDay()] ?? "").slice(0, 3);
			case "DD":
				return pad(date.getDate());
			case "D":
				return String(date.getDate());
			case "HH":
				return pad(hours24);
			case "H":
				return String(hours24);
			case "hh":
				return pad(hours12);
			case "h":
				return String(hours12);
			case "mm":
				return pad(date.getMinutes());
			case "m":
				return String(date.getMinutes());
			case "ss":
				return pad(date.getSeconds());
			case "s":
				return String(date.getSeconds());
			case "A":
				return hours24 < 12 ? "AM" : "PM";
			case "a":
				return hours24 < 12 ? "am" : "pm";
			default:
				return token;
		}
	});
}

/**
 * Format with the user's pattern, falling back to the default when the pattern
 * is blank or contains no token at all — a format that renders to a constant
 * string is always a typo, and silently writing "abc" into the note is worse
 * than ignoring the setting.
 */
export function formatWithPattern(date: Date, pattern: string): string {
	const trimmed = pattern.trim();
	if (trimmed.length === 0) return formatDate(date, DEFAULT_DATE_FORMAT);
	const rendered = formatDate(date, trimmed);
	return rendered === trimmed && !trimmed.includes("[")
		? formatDate(date, DEFAULT_DATE_FORMAT)
		: rendered;
}
