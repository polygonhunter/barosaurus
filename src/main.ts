import { Plugin } from "obsidian";

/**
 * Barosaurus — one bar for everything.
 *
 * main.ts stays thin on purpose: load settings, construct the subsystems,
 * register the command and the ribbon entry, hand everything else off.
 */
export default class BarosaurusPlugin extends Plugin {
	async onload(): Promise<void> {
		// Filled in by the milestones that follow; the scaffold builds green
		// so every later step has a working pipeline to land in.
	}
}
