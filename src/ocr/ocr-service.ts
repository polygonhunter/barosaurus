import type { App } from "obsidian";
import { createWorker, OEM, type Worker } from "tesseract.js";
import { assetUrl } from "./assets";

/**
 * One persistent tesseract.js worker. Created lazily on the first job,
 * terminated on unload or language change. All runtime files load from the
 * plugin's assets dir via app:// URLs — no network after the one-time
 * download.
 */
export class OcrService {
	private worker: Worker | null = null;
	private workerLangs = "";
	/**
	 * The worker being created right now. createWorker takes seconds (it
	 * loads the wasm core and the models); a terminate() that arrived during
	 * that window used to find `worker === null`, return, and let the
	 * finished worker live on unowned.
	 */
	private creating: Promise<Worker> | null = null;
	private creatingLangs = "";

	constructor(
		private readonly app: App,
		private readonly manifestDir: string,
	) {}

	async recognize(imagePathOrUrl: string, langs: string): Promise<string> {
		const worker = await this.getWorker(langs);
		const result = await worker.recognize(imagePathOrUrl);
		return result.data.text.trim();
	}

	async terminate(): Promise<void> {
		const creating = this.creating;
		this.creating = null;
		this.creatingLangs = "";
		const worker = this.worker;
		this.worker = null;
		this.workerLangs = "";
		if (worker) await worker.terminate().catch(() => undefined);
		if (creating) {
			const late = await creating.catch(() => null);
			if (late) await late.terminate().catch(() => undefined);
		}
	}

	private async getWorker(langs: string): Promise<Worker> {
		if (this.worker && this.workerLangs === langs) return this.worker;
		if (this.creating && this.creatingLangs === langs) return this.creating;
		await this.terminate();
		const creating = createWorker(langs.split("+"), OEM.LSTM_ONLY, {
			workerPath: assetUrl(this.app, this.manifestDir, "worker.min.js"),
			corePath: assetUrl(this.app, this.manifestDir, "tesseract-core-simd-lstm.wasm.js"),
			// tesseract appends `/${lang}.traineddata.gz` itself.
			langPath: assetUrl(this.app, this.manifestDir, "").replace(/\/$/, ""),
			gzip: true,
			cacheMethod: "none", // our own cache; keep IndexedDB out of it
		});
		this.creating = creating;
		this.creatingLangs = langs;
		const worker = await creating;
		if (this.creating !== creating) {
			// terminate() ran while we waited and has already disposed of this
			// worker (or is about to). Using it now would race that.
			throw new Error("Barosaurus: OCR worker was stopped while starting");
		}
		this.creating = null;
		this.creatingLangs = "";
		this.worker = worker;
		this.workerLangs = langs;
		return worker;
	}
}
