import { apiVersion, debounce, Notice, Platform, Plugin } from "obsidian";
import { SearchEngine } from "./core/engine";
import {
	bumpFrecency,
	frecencyBoost,
	pruneFrecency,
	renameFrecency,
	type FrecencyEntry,
} from "./core/frecency";
import { supportUrl } from "./core/catalog";
import { contextBoosts } from "./core/context";
import { DEFAULT_WEIGHTS } from "./core/index-types";
import { fileItemId, frecencyKeyFor } from "./core/types";
import type { RankOptions } from "./core/rank";
import { Indexer } from "./index/indexer";
import { OcrPipeline } from "./ocr/pipeline";
import { readContext } from "./services/context-service";
import { bookmarksSource } from "./sources/bookmarks";
import { commandsSource } from "./sources/commands";
import { createSource } from "./sources/create";
import { filesSource } from "./sources/files";
import { foldersSource } from "./sources/folders";
import { ghostSource } from "./sources/ghost";
import { headingsSource } from "./sources/headings";
import { lineSource } from "./sources/line";
import { fullTextSource } from "./sources/fulltext";
import { blocksSource } from "./sources/blocks";
import { settingsTabsSource } from "./sources/settings-tabs";
import type { Source, StreamingSource } from "./sources/source";
import { tabsSource } from "./sources/tabs";
import { tagsSource } from "./sources/tags";
import {
	BarosaurusSettingTab,
	DEFAULT_SETTINGS,
	type BarosaurusSettings,
} from "./settings";
import { createActionController } from "./ui/action-panel";
import { choose, type ExecuteHost } from "./ui/execute";
import { OmnibarModal } from "./ui/omnibar-modal";

/** Shape of data.json: settings plus the small synced user state. */
interface StoredShape {
	settings: BarosaurusSettings;
	data: PersistentData;
}

interface PersistentData {
	frecency: Record<string, FrecencyEntry>;
	history: string[];
}

const DEFAULT_DATA: PersistentData = { frecency: {}, history: [] };

/** Every source, in the order their groups appear when scores tie. */
const ALL_SOURCES: readonly (Source | StreamingSource)[] = [
	lineSource,
	commandsSource,
	blocksSource,
	tabsSource,
	filesSource,
	headingsSource,
	bookmarksSource,
	foldersSource,
	tagsSource,
	fullTextSource,
	settingsTabsSource,
	ghostSource,
	createSource,
];

export default class BarosaurusPlugin extends Plugin {
	settings: BarosaurusSettings = { ...DEFAULT_SETTINGS };
	data: PersistentData = structuredClone(DEFAULT_DATA);
	ocr: OcrPipeline | undefined;

	private readonly engine = new SearchEngine(DEFAULT_WEIGHTS);
	private indexer: Indexer | null = null;
	private lastShiftAt = 0;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.ocr = new OcrPipeline(
			this.app,
			this.engine,
			() => this.settings,
			this.manifest.dir ?? "",
			() => this.indexer?.persistSoon(),
		);
		this.indexer = new Indexer(this.app, this.engine, DEFAULT_WEIGHTS, {
			getSettings: () => ({ excludedFolders: this.settings.excludedFolders }),
		});

		// Obsidian prefixes the plugin name itself, so this renders as
		// "Barosaurus: Open". Naming it "Open Barosaurus" would stutter.
		this.addCommand({ id: "open", name: "Open", callback: () => this.openBar() });

		if (this.settings.showRibbonIcon) {
			// Tappable entry point — on phones this lands in the side menu, so
			// the bar is reachable without configuring anything.
			this.addRibbonIcon("chevrons-right", "Barosaurus: Open", () => this.openBar());
		}

		this.addSettingTab(new BarosaurusSettingTab(this.app, this));

		this.registerDoubleShift();

		// Count every open so frecency has something to learn from — including
		// opens that never went through the bar. The key MUST be the item id,
		// not the bare path: the ranker looks up frecency[item.id], so a raw
		// path here would be written, pruned and never read, while its dead
		// entries evicted the live ones out of the 400-entry budget.
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!file) return;
				const now = Date.now();
				bumpFrecency(this.data.frecency, fileItemId(file.path), now);
				pruneFrecency(this.data.frecency, now);
				this.saveDataSoon();
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				// Same namespace on both sides, or a rename orphans the history.
				renameFrecency(this.data.frecency, fileItemId(oldPath), fileItemId(file.path));
				const pin = this.settings.pins.indexOf(fileItemId(oldPath));
				if (pin >= 0) this.settings.pins[pin] = fileItemId(file.path);
				this.saveDataSoon();
			}),
		);

		// Build the index once the workspace is up. Registering vault events
		// any earlier floods the queue: vault.on('create') fires for every
		// existing file while the vault loads.
		this.app.workspace.onLayoutReady(() => {
			void (async () => {
				await this.indexer?.start(this);
				await this.ocr?.init(this);
				if (this.settings.ocrEnabled || this.settings.indexPdfText) {
					await this.ocr?.enable();
				}
			})();
		});
	}

	onunload(): void {
		this.indexer?.stop();
		this.indexer = null;
		void this.ocr?.destroy();
		this.ocr = undefined;
	}

	// ------------------------------------------------------------- opening

	private openBar(): void {
		// Deferred: command pickers and the mobile quick-action overlay dismiss
		// themselves right after invoking a command and would sweep a
		// synchronously opened modal away with them. Barosaurus is the command
		// palette's replacement, so it is opened from exactly those overlays.
		window.setTimeout(
			() => {
				try {
					this.buildModal().open();
				} catch (error) {
					console.error("Barosaurus: failed to open the bar", error);
					new Notice(
						`Barosaurus: failed to open — ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			},
			Platform.isMobile ? 150 : 0,
		);
	}

	private buildModal(): OmnibarModal {
		const host: ExecuteHost = {
			app: this.app,
			remember: (id) => {
				const now = Date.now();
				// A file found through its text and the same file found through
				// its title must share one frecency key, or learning splits in
				// two and neither half ever gets strong.
				const key = frecencyKeyFor(id);
				bumpFrecency(this.data.frecency, key, now);
				pruneFrecency(this.data.frecency, now);
				this.saveDataSoon();
			},
			pins: () => this.settings.pins,
			setPins: (next) => {
				this.settings.pins = next;
				this.saveDataSoon();
			},
			hiddenCommands: () => this.settings.hiddenCommands,
			setHiddenCommands: (next) => {
				this.settings.hiddenCommands = next;
				this.saveDataSoon();
			},
			history: () => this.data.history,
			setHistory: (next) => {
				this.data.history = next;
				this.saveDataSoon();
			},
			editingSettings: () => ({
				colorMode: this.settings.colorMode,
				dateFormat: this.settings.dateFormat,
				snippets: this.settings.snippets,
			}),
		};

		return new OmnibarModal(this.app, {
			sources: ALL_SOURCES.filter(
				(source) => !this.settings.disabledSources.includes(source.id),
			),
			context: () => readContext(this.app),
			rankOptions: () => this.rankOptions(),
			// resultLimit caps the RENDERED list, which is what the setting
			// promises. Handing it to sources only would cap each of them
			// separately — nine sources × 40 is 360 rows, not 40. Each source
			// still gets a generous share so a single one cannot crowd out the
			// rest before grouping trims.
			sourceLimit: Math.max(10, Math.ceil(this.settings.resultLimit / 2)),
			grouping: {
				maxItems: this.settings.resultLimit,
				perGroupLimit: Math.max(3, Math.ceil(this.settings.resultLimit / 4)),
			},
			// The core feature: with text selected, everything that acts on a
			// selection rises. Off means the callback is simply absent.
			contextBoostFor: this.settings.useContextRanking ? contextBoosts : undefined,
			showPreview: this.settings.showPreview,
			index: () => this.indexer,
			settings: () => this.settings,
			actions: createActionController(host),
			placeholder: "Search, jump, or do something…",
			onChoose: (item, _evt, paneType) => void choose(host, item, paneType),
		});
	}

	/**
	 * Frecency and pins. Context boosts are NOT here: they need the candidate
	 * list, which only the modal has, so they go in through contextBoostFor.
	 */
	private rankOptions(): RankOptions {
		const frecency: Record<string, number> = {};
		if (this.settings.useFrecency) {
			const now = Date.now();
			for (const [key, entry] of Object.entries(this.data.frecency)) {
				frecency[key] = frecencyBoost(entry, now);
			}
		}
		return { frecency, pinned: new Set(this.settings.pins) };
	}

	/**
	 * Double-tap shift, so the bar can be opened without claiming a key
	 * combination. Only fires when shift is pressed and released alone — a
	 * shift that was part of a chord must never open anything.
	 */
	private registerDoubleShift(): void {
		// activeWindow, not the global: a popout window has its own document,
		// and the bare global would leave the trigger dead there.
		this.registerDomEvent(activeWindow.document, "keyup", (event: KeyboardEvent) => {
			if (this.settings.triggerStyle !== "double-shift") return;
			// Never stack a second bar on top of the one already open.
			if (activeDocument.querySelector(".barosaurus-modal") !== null) return;
			if (event.key !== "Shift" || event.ctrlKey || event.altKey || event.metaKey) {
				this.lastShiftAt = 0;
				return;
			}
			const now = Date.now();
			if (now - this.lastShiftAt <= this.settings.doubleShiftWindowMs) {
				this.lastShiftAt = 0;
				this.openBar();
				return;
			}
			this.lastShiftAt = now;
		});
	}

	// ------------------------------------------------------------- settings

	onSettingsChanged(): void {
		this.indexer?.onSettingsChanged();
	}

	async rebuildIndex(): Promise<void> {
		await this.indexer?.rebuild();
	}

	openSupport(): void {
		// The only outbound link in the plugin, and only ever on a click.
		window.open(
			supportUrl({
				pluginVersion: this.manifest.version,
				obsidianVersion: apiVersion,
				platform: Platform.isPhone
					? "phone"
					: Platform.isTablet
						? "tablet"
						: Platform.isMacOS
							? "macos"
							: Platform.isWin
								? "windows"
								: "linux",
			}),
		);
	}

	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as Partial<StoredShape> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(raw?.settings ?? {}) };
		this.data = { ...structuredClone(DEFAULT_DATA), ...(raw?.data ?? {}) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData({ settings: this.settings, data: this.data } satisfies StoredShape);
	}

	readonly saveDataSoon = debounce(() => void this.saveSettings(), 2_000, true);
}

// contextBoosts is re-exported so the modal can apply it without importing
// main.ts, which would create a cycle.
export { contextBoosts };
