import { fold } from "../core/normalize";
import type { Candidate, OmniItem } from "../core/types";
import { listSettingTabs } from "../ui/unsafe";
import { fuzzyFactory, orderByMatch, type Scorable } from "./files";
import { candidatesFromOrdered, type Source, type SourceContext } from "./source";

/**
 * Settings pages, searchable like commands — the way Raycast exposes system
 * settings. "appearance" should land on the appearance page instead of making
 * the user open settings and hunt down a sidebar.
 *
 * The rows are `kind: "action"` items, because a settings page is not a
 * registered command: the executor reads the `ACTION_ID_PREFIX` off `actionId`
 * and calls `openSettingsTab(app, id)`. Both the tab list and the opening are
 * internal, so the whole source disappears when they do.
 */

/** The executor switches on this prefix; the remainder is the tab id. */
export const SETTINGS_ACTION_PREFIX = "open-settings:";

/** Extra match terms, English only — the rest of the catalog was cleared in 0.9.3. */
const SETTINGS_ALIASES = ["settings", "preferences", "options", "config", "preferences pane"];

export const settingsTabsSource: Source = {
	id: "settings-tab",

	/**
	 * ">" is reserved for real commands — a settings page cannot be executed,
	 * assigned a hotkey or pinned, and pretending otherwise makes the command
	 * scope lie. Vault operators exclude this source for the same reason they
	 * exclude commands.
	 */
	appliesTo(ctx: SourceContext): boolean {
		return (
			ctx.query.scope === "all" &&
			ctx.query.kind === null &&
			ctx.query.pathPrefix === null &&
			ctx.query.modifiedWithinDays === null &&
			ctx.query.tags.length === 0
		);
	},

	getCandidates(ctx: SourceContext): Candidate[] {
		const { app, query, limit } = ctx;
		if (limit <= 0) return [];

		const entries: Array<Scorable<OmniItem>> = listSettingTabs(app).map(({ id, name }) => {
			// "Editor settings" rather than "Editor": a bare page name would win
			// the exact-match tier against a note that is actually called Editor.
			const title = `${name} settings`;
			const item: OmniItem = {
				id: `settings:${id}`,
				kind: "action",
				source: "command",
				group: "commands",
				title,
				aliases: [name, ...SETTINGS_ALIASES.map((alias) => `${alias} ${name}`), ...SETTINGS_ALIASES],
				subtitle: "Settings",
				tile: { kind: "icon", icon: "settings" },
				actionId: `${SETTINGS_ACTION_PREFIX}${id}`,
				contextTags: ["navigation"],
			};
			return {
				value: item,
				terms: [fold(title), fold(name)].filter((term) => term.length > 0),
			};
		});

		return candidatesFromOrdered(orderByMatch(entries, fold(query.text), fuzzyFactory, limit));
	},
};
