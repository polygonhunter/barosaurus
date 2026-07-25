import type { ActionDef, BarContext, OmniItem } from "./types";

/**
 * The environment capabilities the pure filters need, injected so core stays
 * obsidian-free: production wires app.plugins.enabledPlugins and the internal
 * plugin registry, tests wire an object literal.
 */
export interface PluginCapabilities {
	isPluginEnabled(id: string): boolean;
	isCorePluginEnabled(id: string): boolean;
}

/** Everything available — the default when nothing is gated. */
export const ALL_AVAILABLE: PluginCapabilities = {
	isPluginEnabled: () => true,
	isCorePluginEnabled: () => true,
};

/** Nothing available — the safe fallback when the internals are missing. */
export const NONE_AVAILABLE: PluginCapabilities = {
	isPluginEnabled: () => false,
	isCorePluginEnabled: () => false,
};

interface Gated {
	requiresPlugin?: string;
	requiresCorePlugin?: string;
}

/**
 * Drop entries whose required plugin is not installed and enabled. A group
 * whose entries all vanish leaves no trace — no overline label, no dead rows.
 */
export function filterAvailable<T extends Gated>(
	entries: readonly T[],
	caps: PluginCapabilities,
): T[] {
	return entries.filter(
		(entry) =>
			(entry.requiresPlugin === undefined || caps.isPluginEnabled(entry.requiresPlugin)) &&
			(entry.requiresCorePlugin === undefined ||
				caps.isCorePluginEnabled(entry.requiresCorePlugin)),
	);
}

/**
 * The actions offered for one highlighted item, in registry order. The first
 * one is the primary action — Enter runs it — so registry order is a product
 * decision, not an implementation detail.
 */
export function actionsFor(
	registry: readonly ActionDef[],
	item: OmniItem,
	ctx: BarContext,
	caps: PluginCapabilities,
): ActionDef[] {
	return filterAvailable(registry, caps).filter((action) => action.appliesTo(item, ctx));
}
