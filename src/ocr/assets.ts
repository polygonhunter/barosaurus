import { Notice, normalizePath, requestUrl, type App } from "obsidian";
import { unzipSync } from "fflate";

/**
 * OCR runtime assets (~8 MB: tesseract worker, WASM core, deu/eng
 * traineddata). Far too big to bundle into main.js — downloaded ONCE from a
 * pinned release of this repo into <plugin>/assets/, which also syncs them
 * to other devices. Fully offline afterwards.
 *
 * Nothing in here runs on plugin load. The download happens only when the
 * user switches OCR on, or when an enabled OCR job finds the assets missing.
 */

export const ASSET_FILES = [
	"worker.min.js",
	"tesseract-core-simd-lstm.wasm.js",
	"deu.traineddata.gz",
	"eng.traineddata.gz",
] as const;

const ASSET_RELEASE_URL =
	"https://github.com/polygonhunter/barosaurus/releases/download/ocr-assets-v1/barosaurus-ocr-assets.zip";

/**
 * sha256 of the release zip, re-pinned whenever the ocr-assets release is
 * rebuilt. Produced by `npm run fetch-ocr-assets` + `shasum -a 256`.
 *
 * An empty value means REFUSE, not "skip the check". The inherited behaviour
 * was the opposite, and it is the wrong default by a wide margin: what this
 * archive contains is a Web Worker and a WASM core that the plugin then
 * executes, so an unverified download is arbitrary code execution. Dev builds
 * never reach this path — esbuild pre-copies assets/ocr into the test vault.
 */
const ASSET_SHA256 = "005cfbe910b837de0e330f876fe9405898f2068a2813c3a1bfb5e11a3f3ca71e";

export function assetDir(manifestDir: string): string {
	return normalizePath(`${manifestDir}/assets`);
}

export async function assetsPresent(app: App, manifestDir: string): Promise<boolean> {
	const dir = assetDir(manifestDir);
	for (const file of ASSET_FILES) {
		if (!(await app.vault.adapter.exists(normalizePath(`${dir}/${file}`)))) return false;
	}
	return true;
}

/** Download + verify + unzip into the plugin dir. Throws on failure. */
export async function downloadAssets(app: App, manifestDir: string): Promise<void> {
	// Refuse before touching the network at all, rather than downloading and
	// then discovering we have nothing to compare against.
	if (ASSET_SHA256.length === 0) {
		throw new Error(
			"text recognition is not available in this build — no verified model archive is pinned",
		);
	}

	const notice = new Notice("Barosaurus: downloading text-recognition models…", 0);
	try {
		const response = await requestUrl({ url: ASSET_RELEASE_URL, method: "GET" });
		const zipData = new Uint8Array(response.arrayBuffer);

		// activeWindow.crypto, not the bare global — the plugin runs in popout
		// windows too, and CLAUDE.md forbids the globals for exactly that reason.
		const digest = await activeWindow.crypto.subtle.digest("SHA-256", zipData);
		const hex = [...new Uint8Array(digest)]
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
		if (hex !== ASSET_SHA256) {
			throw new Error("model archive failed verification — refusing to install it");
		}

		const files = unzipSync(zipData);
		const dir = assetDir(manifestDir);
		if (!(await app.vault.adapter.exists(dir))) {
			await app.vault.adapter.mkdir(dir);
		}
		for (const name of ASSET_FILES) {
			const content = files[name];
			if (!content) throw new Error(`OCR asset bundle is missing ${name}`);
			// Copy into a fresh, exactly-sized buffer for writeBinary.
			await app.vault.adapter.writeBinary(
				normalizePath(`${dir}/${name}`),
				new Uint8Array(content).buffer,
			);
		}
		notice.setMessage("Barosaurus: text recognition ready.");
		window.setTimeout(() => notice.hide(), 3000);
	} catch (error) {
		notice.hide();
		new Notice(
			"Barosaurus: could not download the text-recognition models. Check your connection and try again from the settings.",
			8000,
		);
		throw error;
	}
}

/** Ensure assets exist, downloading if needed. Returns success. */
export async function ensureAssets(app: App, manifestDir: string): Promise<boolean> {
	if (await assetsPresent(app, manifestDir)) return true;
	try {
		await downloadAssets(app, manifestDir);
		return true;
	} catch {
		return false;
	}
}

/** app:// URL for an asset file, query-string stripped (tesseract appends). */
export function assetUrl(app: App, manifestDir: string, file: string): string {
	const resource = app.vault.adapter.getResourcePath(
		normalizePath(`${assetDir(manifestDir)}/${file}`),
	);
	return resource.split("?")[0] ?? resource;
}
