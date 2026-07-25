import { MarkdownView, type App, type Editor } from "obsidian";
import type { BarContext } from "../core/types";

/**
 * Reads the editing situation the ranker and the action registry depend on.
 *
 * Deliberately a plain function rather than a class with cached state: it runs
 * once per keystroke, and a stale selection is worse than a cheap read. A user
 * who selects a sentence and types "b" must see Bold rise on THAT keystroke,
 * not on the next one.
 */
export function readContext(app: App): BarContext {
	const editor = activeEditor(app);
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	return {
		activeFile: app.workspace.getActiveFile()?.path ?? null,
		// The bar steals focus the moment it opens, so the selection has to be
		// read from the editor rather than from the document selection.
		selection: editor?.getSelection() ?? "",
		hasEditor: editor !== null,
		viewType: view?.getViewType() ?? app.workspace.getLeaf(false).getViewState().type ?? null,
		now: Date.now(),
	};
}

/**
 * The editor the bar would write into. `activeEditor` is the public seam and
 * survives the modal taking focus; getActiveViewOfType alone returns null once
 * a modal is open in some layouts.
 */
export function activeEditor(app: App): Editor | null {
	const fromWorkspace = app.workspace.activeEditor?.editor;
	if (fromWorkspace) return fromWorkspace;
	return app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? null;
}
