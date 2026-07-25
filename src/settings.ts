import { Platform, PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import type { UserSnippet } from "./core/blocks";
import type { ColorMode } from "./core/style";
import type { OcrController } from "./ocr/pipeline";

/**
 * Settings for Barosaurus.
 *
 * Deliberately NOT the declarative 1.13 settings API: minAppVersion is 1.12.4,
 * and getSettingDefinitions() and friends do not exist there. The imperative
 * display() is marked deprecated in the newest typings, and the deprecation
 * notice itself says to keep using it "as a fallback for plugins that need to
 * support Obsidian versions older than 1.13.0". That is us. One code path
 * serves every version from the floor up.
 */

export type TriggerStyle = "hotkey-only" | "double-shift";

export interface BarosaurusSettings {
	// ---- opening
	/** Double-tap shift opens the bar, IntelliJ style. */
	triggerStyle: TriggerStyle;
	/** Milliseconds between the two shift taps. */
	doubleShiftWindowMs: number;
	/** Add a ribbon icon — the only entry point that needs no configuration. */
	showRibbonIcon: boolean;

	// ---- results
	/** Rows rendered before the list is cut off. */
	resultLimit: number;
	/** Sources the user has switched off entirely. */
	disabledSources: string[];
	/** Search inside note contents, not just titles. */
	fullTextSearch: boolean;
	/** Show a preview beside the list (never on phones — no room). */
	showPreview: boolean;

	// ---- ranking
	/** What you use often keeps its pull while you type. */
	useFrecency: boolean;
	/** Selecting text lifts the things that act on a selection. */
	useContextRanking: boolean;
	/** Hide commands that cannot run right now instead of showing them dead. */
	hideUnavailableCommands: boolean;

	// ---- editing
	/** Theme colours adapt to dark mode; hex survives export to other apps. */
	colorMode: ColorMode;
	/** Format for the "insert date" entry. Pure formatter, no moment. */
	dateFormat: string;
	/** User-defined blocks; {cursor} marks the writing position. */
	snippets: UserSnippet[];

	// ---- indexing
	/** Folders skipped entirely, one per line. */
	excludedFolders: string[];

	// ---- text extraction (opt-in, nothing downloads or runs until switched on)
	/** Recognize text inside images. Desktop only; needs the model download. */
	ocrEnabled: boolean;
	/** Read the text layer of PDFs. Independent of OCR — no download needed. */
	indexPdfText: boolean;
	/** Recognition models to use, e.g. ["deu", "eng"]. */
	ocrLanguages: string[];

	// ---- persistence of user state
	/** Ids the user pinned to the top. */
	pins: string[];
	/** Command ids hidden from the bar. */
	hiddenCommands: string[];
}

export const DEFAULT_SETTINGS: BarosaurusSettings = {
	triggerStyle: "hotkey-only",
	doubleShiftWindowMs: 300,
	showRibbonIcon: true,
	resultLimit: 40,
	disabledSources: [],
	fullTextSearch: true,
	showPreview: true,
	useFrecency: true,
	useContextRanking: true,
	hideUnavailableCommands: true,
	colorMode: "theme",
	dateFormat: "YYYY-MM-DD",
	snippets: [],
	excludedFolders: [],
	// Opt-in means opt-in: both start off, so a fresh install makes no network
	// request and does no background recognition until asked to.
	ocrEnabled: false,
	indexPdfText: false,
	ocrLanguages: ["deu", "eng"],
	pins: [],
	hiddenCommands: [],
};

/** Structural host interface — avoids a settings.ts ↔ main.ts import cycle. */
export interface SettingsHost extends Plugin {
	settings: BarosaurusSettings;
	saveSettings(): Promise<void>;
	/** Re-apply anything derived from settings (sources, index filters). */
	onSettingsChanged(): void;
	/** Drop the index and rebuild it from scratch. */
	rebuildIndex(): Promise<void>;
	/** Open the contact form with version and platform prefilled. */
	openSupport(): void;
	/**
	 * Text extraction from images and PDFs, if the plugin wired one up. Left
	 * optional so the settings tab degrades to "the switches are remembered,
	 * nothing acts on them" rather than throwing.
	 */
	ocr?: OcrController;
}

/** Sources the user can switch off, with a label and why they might want to. */
const TOGGLEABLE_SOURCES: ReadonlyArray<{ id: string; name: string; desc: string }> = [
	{ id: "command", name: "Commands", desc: "Every registered command, including plugins." },
	{ id: "file", name: "Notes and files", desc: "Titles, aliases and paths." },
	{ id: "tab", name: "Open tabs", desc: "Jump straight to something already open." },
	{ id: "heading", name: "Headings and blocks", desc: "Structure inside your notes." },
	{ id: "bookmark", name: "Bookmarks", desc: "Requires the Bookmarks core plugin." },
	{ id: "folder", name: "Folders", desc: "Open or move things into a folder." },
	{ id: "tag", name: "Tags", desc: "Every tag in the vault, with its count." },
];

export class BarosaurusSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly host: SettingsHost,
	) {
		super(app, host);
	}

	private async persist(): Promise<void> {
		await this.host.saveSettings();
		this.host.onSettingsChanged();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.host.settings;

		this.renderOpening(settings);
		this.renderResults(settings);
		this.renderRanking(settings);
		this.renderEditing(settings);
		this.renderIndexing(settings);
		this.renderTextExtraction(settings);
		this.renderAbout();
	}

	// ------------------------------------------------------------- opening

	private renderOpening(settings: BarosaurusSettings): void {
		const { containerEl } = this;
		new Setting(containerEl).setName("Opening the bar").setHeading();

		// Obsidian's guidelines say a plugin must not claim a default hotkey,
		// so the honest thing is to explain the choice rather than take one.
		new Setting(containerEl)
			.setName("Hotkey")
			.setDesc(
				"Barosaurus ships without a shortcut, because a plugin should not take one from you. " +
					"Assign one under Settings → Hotkeys, searching for “Open Barosaurus”. " +
					"Cmd+K is the natural home; note that Obsidian uses it for “Insert link”, so you " +
					"would move that one to Cmd+Shift+K first.",
			)
			.addButton((button) =>
				button
					.setButtonText("Open hotkey settings")
					.setCta()
					.onClick(() => this.openHotkeySettings()),
			);

		new Setting(containerEl)
			.setName("Double-tap shift")
			.setDesc(
				"Open the bar by pressing shift twice, so it works without claiming any key combination.",
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.triggerStyle === "double-shift").onChange(async (value) => {
					settings.triggerStyle = value ? "double-shift" : "hotkey-only";
					await this.persist();
					this.display();
				}),
			);

		if (settings.triggerStyle === "double-shift") {
			new Setting(containerEl)
				.setName("Double-tap speed")
				.setDesc(
					"How long the second shift may take. Lower if the bar opens when you did not mean it to.",
				)
				.addSlider((slider) =>
					slider
						.setLimits(150, 600, 25)
						.setValue(settings.doubleShiftWindowMs)
						.setDynamicTooltip()
						.onChange(async (value) => {
							settings.doubleShiftWindowMs = value;
							await this.persist();
						}),
				);
		}

		new Setting(containerEl)
			.setName("Ribbon icon")
			.setDesc(
				"Show an icon in the left ribbon. On phones this lands in the side menu, which makes the " +
					"bar reachable without configuring anything.",
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.showRibbonIcon).onChange(async (value) => {
					settings.showRibbonIcon = value;
					await this.persist();
				}),
			);
	}

	// ------------------------------------------------------------- results

	private renderResults(settings: BarosaurusSettings): void {
		const { containerEl } = this;
		new Setting(containerEl).setName("Results").setHeading();

		new Setting(containerEl)
			.setName("Result limit")
			.setDesc("How many rows to render before the list is cut off.")
			.addSlider((slider) =>
				slider
					.setLimits(10, 100, 5)
					.setValue(settings.resultLimit)
					.setDynamicTooltip()
					.onChange(async (value) => {
						settings.resultLimit = value;
						await this.persist();
					}),
			);

		new Setting(containerEl)
			.setName("Search inside notes")
			.setDesc(
				"Also match the text of your notes, not only their titles. Title matches always come first; " +
					"text matches stream in behind them.",
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.fullTextSearch).onChange(async (value) => {
					settings.fullTextSearch = value;
					await this.persist();
				}),
			);

		new Setting(containerEl)
			.setName("Preview pane")
			.setDesc(
				"Render the highlighted result beside the list. Phones never show it — there is no room.",
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.showPreview).onChange(async (value) => {
					settings.showPreview = value;
					await this.persist();
				}),
			);

		new Setting(containerEl)
			.setName("Sources")
			.setDesc("Everything the bar may offer. Switching one off removes its group entirely.");

		for (const source of TOGGLEABLE_SOURCES) {
			new Setting(containerEl)
				.setName(source.name)
				.setDesc(source.desc)
				.addToggle((toggle) =>
					toggle
						.setValue(!settings.disabledSources.includes(source.id))
						.onChange(async (value) => {
							settings.disabledSources = value
								? settings.disabledSources.filter((id) => id !== source.id)
								: [...settings.disabledSources, source.id];
							await this.persist();
						}),
				);
		}
	}

	// ------------------------------------------------------------- ranking

	private renderRanking(settings: BarosaurusSettings): void {
		const { containerEl } = this;
		new Setting(containerEl).setName("Ranking").setHeading();

		new Setting(containerEl)
			.setName("Learn what you use")
			.setDesc(
				"What you pick often and recently keeps its pull — while you type, not only in the empty " +
					"list. Switch off for strictly alphabetical, predictable ordering.",
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.useFrecency).onChange(async (value) => {
					settings.useFrecency = value;
					await this.persist();
				}),
			);

		new Setting(containerEl)
			.setName("Rank by what you are doing")
			.setDesc(
				"With text selected, the things that act on a selection move up: type b for bold, h2 for a " +
					"heading. With no editor open, they move back down.",
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.useContextRanking).onChange(async (value) => {
					settings.useContextRanking = value;
					await this.persist();
				}),
			);

		new Setting(containerEl)
			.setName("Hide commands that cannot run")
			.setDesc(
				"Ask each command whether it is available right now and leave out the ones that are not, " +
					"instead of showing an entry that does nothing.",
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.hideUnavailableCommands).onChange(async (value) => {
					settings.hideUnavailableCommands = value;
					await this.persist();
				}),
			);

		new Setting(containerEl)
			.setName("Pinned entries")
			.setDesc(
				settings.pins.length === 0
					? "Nothing pinned yet. Press Cmd+P on any result to pin it to the top."
					: `${settings.pins.length} pinned. Press Cmd+P on a result to pin or unpin it.`,
			)
			.addButton((button) =>
				button
					.setButtonText("Clear")
					.setDisabled(settings.pins.length === 0)
					.onClick(async () => {
						settings.pins = [];
						await this.persist();
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName("Hidden commands")
			.setDesc(
				settings.hiddenCommands.length === 0
					? "Nothing hidden. Use the action panel on a command to hide it from this bar."
					: `${settings.hiddenCommands.length} hidden from this bar. They still work everywhere else.`,
			)
			.addButton((button) =>
				button
					.setButtonText("Show all again")
					.setDisabled(settings.hiddenCommands.length === 0)
					.onClick(async () => {
						settings.hiddenCommands = [];
						await this.persist();
						this.display();
					}),
			);
	}

	// ------------------------------------------------------------- editing

	private renderEditing(settings: BarosaurusSettings): void {
		const { containerEl } = this;
		new Setting(containerEl).setName("Editing").setHeading();

		new Setting(containerEl)
			.setName("Colour format")
			.setDesc(
				"Theme colours follow your light and dark mode and stay readable when you switch. " +
					"Hex values are fixed, but survive exporting your notes to other apps.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("theme", "Theme colours (adapts to dark mode)")
					.addOption("hex", "Hex values (portable)")
					.setValue(settings.colorMode)
					.onChange(async (value) => {
						settings.colorMode = value === "hex" ? "hex" : "theme";
						await this.persist();
					}),
			);

		new Setting(containerEl)
			.setName("Date format")
			.setDesc("Used by the “insert date” entry. Supports YYYY, MM, DD, HH and mm.")
			.addText((text) =>
				text
					.setPlaceholder("YYYY-MM-DD")
					.setValue(settings.dateFormat)
					.onChange(async (value) => {
						settings.dateFormat = value.trim() || "YYYY-MM-DD";
						await this.persist();
					}),
			);

		new Setting(containerEl)
			.setName("Snippets")
			.setDesc(
				"Your own blocks, offered next to the built-in ones. Write {cursor} where the cursor should " +
					"land after inserting.",
			);

		settings.snippets.forEach((snippet, index) => {
			new Setting(containerEl)
				.addText((text) =>
					text
						.setPlaceholder("Name")
						.setValue(snippet.name)
						.onChange(async (value) => {
							const entry = settings.snippets[index];
							if (entry) entry.name = value;
							await this.persist();
						}),
				)
				.addText((text) =>
					text
						.setPlaceholder("Template with {cursor}")
						.setValue(snippet.template)
						.onChange(async (value) => {
							const entry = settings.snippets[index];
							if (entry) entry.template = value;
							await this.persist();
						}),
				)
				.addExtraButton((button) =>
					button
						.setIcon("x")
						.setTooltip("Remove")
						.onClick(async () => {
							settings.snippets.splice(index, 1);
							await this.persist();
							this.display();
						}),
				);
		});

		new Setting(containerEl).addButton((button) =>
			button.setButtonText("Add snippet").onClick(async () => {
				settings.snippets.push({ name: "", template: "{cursor}" });
				await this.persist();
				this.display();
			}),
		);
	}

	// ------------------------------------------------------------ indexing

	private renderIndexing(settings: BarosaurusSettings): void {
		const { containerEl } = this;
		new Setting(containerEl).setName("Indexing").setHeading();

		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc(
				"One folder per line. Everything inside is skipped, including subfolders. Matching respects " +
					"folder boundaries, so “templates” does not also exclude “templates-archive”.",
			)
			.addTextArea((area) =>
				area
					.setPlaceholder("templates\narchive/2019")
					.setValue(settings.excludedFolders.join("\n"))
					.onChange(async (value) => {
						settings.excludedFolders = value
							.split("\n")
							.map((line) => line.trim())
							.filter((line) => line.length > 0);
						await this.persist();
					}),
			);

		new Setting(containerEl)
			.setName("Rebuild the index")
			.setDesc(
				"Throw away everything Barosaurus has cached and read the vault again. Only needed if results " +
					"look stale.",
			)
			.addButton((button) =>
				button.setButtonText("Rebuild").onClick(async () => {
					button.setDisabled(true).setButtonText("Rebuilding…");
					await this.host.rebuildIndex();
					button.setDisabled(false).setButtonText("Rebuild");
				}),
			);
	}

	// ------------------------------------------------------ text extraction

	private renderTextExtraction(settings: BarosaurusSettings): void {
		const { containerEl } = this;
		new Setting(containerEl).setName("Text in images and PDFs").setHeading();

		new Setting(containerEl)
			.setName("Read text inside images")
			.setDesc(
				Platform.isDesktop
					? "Make the words in screenshots and photos searchable. Switching this on downloads the " +
							"recognition models once, about 8 MB, from this plugin's GitHub release — the only " +
							"network request Barosaurus ever makes. Everything after that happens offline on your own " +
							"machine, in the background, and each image is read only once."
					: "Reading text inside images needs a desktop or laptop: the recognition models do not run " +
							"on phones and tablets. Anything already read on a desktop syncs across and stays " +
							"searchable here.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.ocrEnabled)
					.setDisabled(!Platform.isDesktop)
					.onChange(async (value) => {
						settings.ocrEnabled = value;
						await this.persist();
						this.display();
						await this.applyExtractionChange();
					}),
			);

		if (settings.ocrEnabled && Platform.isDesktop) {
			new Setting(containerEl)
				.setName("Recognition languages")
				.setDesc(
					"Which languages to expect in your images. The download carries German and English; " +
						"reading both is slower than reading one, so pick a single language if your images " +
						"only ever use it.",
				)
				.addDropdown((dropdown) =>
					dropdown
						.addOption("deu+eng", "German and English")
						.addOption("deu", "German")
						.addOption("eng", "English")
						.setValue(settings.ocrLanguages.join("+"))
						.onChange(async (value) => {
							settings.ocrLanguages = value.split("+");
							await this.persist();
							await this.applyExtractionChange();
						}),
				);
		}

		new Setting(containerEl)
			.setName("Read text inside PDFs")
			.setDesc(
				"Search the contents of your PDFs, not just their filenames. Most PDFs already carry a real " +
					"text layer, so this needs no recognition and no download, and it works on every device. " +
					"Scanned PDFs that are nothing but images stay unsearchable.",
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.indexPdfText).onChange(async (value) => {
					settings.indexPdfText = value;
					await this.persist();
					await this.applyExtractionChange();
				}),
			);
	}

	/**
	 * Apply a change to either extraction switch: stop what is running, then —
	 * if anything is still switched on — fetch what it needs and walk the
	 * vault. Does nothing at all while both switches are off, which is what
	 * keeps a default install free of network requests.
	 */
	private async applyExtractionChange(): Promise<void> {
		const controller = this.host.ocr;
		if (!controller) return;
		const settings = this.host.settings;
		await controller.disable();
		if (settings.ocrEnabled || settings.indexPdfText) {
			await controller.enable();
		}
	}

	// --------------------------------------------------------------- about

	private renderAbout(): void {
		const { containerEl } = this;
		new Setting(containerEl).setName("About").setHeading();

		new Setting(containerEl)
			.setName("Privacy")
			.setDesc(
				"Barosaurus makes no network requests on its own and sends nothing anywhere. The one exception " +
					"is the button below, which opens your browser only when you click it.",
			);

		new Setting(containerEl)
			.setName("Help and feedback")
			.setDesc(
				"Something not working, or an idea for what the bar should do next? The form opens with your " +
					"version and platform already filled in.",
			)
			.addButton((button) =>
				button.setButtonText("Get in touch").onClick(() => this.host.openSupport()),
			);
	}

	/** Best effort: jump straight to the hotkey list, or explain the path. */
	private openHotkeySettings(): void {
		// app.setting is not in the public typings, so this goes through the
		// same defensive route as every other internal — and simply does
		// nothing visible if the shape ever changes.
		const setting = (
			this.app as unknown as {
				setting?: { open?(): void; openTabById?(id: string): void };
			}
		).setting;
		setting?.open?.();
		setting?.openTabById?.("hotkeys");
	}
}
