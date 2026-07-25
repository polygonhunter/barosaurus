/**
 * Collects the OCR runtime assets into assets/ocr/ (build output, not
 * committed):
 *   - tesseract worker + WASM core from node_modules
 *   - deu/eng traineddata (fast variants) from tessdata_fast, gzipped
 *
 * Used two ways:
 *   - locally before `npm run dev` (esbuild copies assets/ocr → test vault),
 *     which keeps the download path out of local development entirely
 *   - to build the barosaurus-ocr-assets.zip release asset, whose sha256 then
 *     gets pinned in src/ocr/assets.ts
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { gzipSync } from "zlib";
import path from "path";

const OUT_DIR = path.join("assets", "ocr");
mkdirSync(OUT_DIR, { recursive: true });

copyFileSync(
	path.join("node_modules", "tesseract.js", "dist", "worker.min.js"),
	path.join(OUT_DIR, "worker.min.js"),
);
copyFileSync(
	path.join("node_modules", "tesseract.js-core", "tesseract-core-simd-lstm.wasm.js"),
	path.join(OUT_DIR, "tesseract-core-simd-lstm.wasm.js"),
);
console.log("copied worker.min.js and tesseract-core-simd-lstm.wasm.js");

const TESSDATA_BASE = "https://github.com/tesseract-ocr/tessdata_fast/raw/main";
for (const lang of ["deu", "eng"]) {
	const target = path.join(OUT_DIR, `${lang}.traineddata.gz`);
	if (existsSync(target)) {
		console.log(`${target} already present, skipping download`);
		continue;
	}
	const response = await fetch(`${TESSDATA_BASE}/${lang}.traineddata`);
	if (!response.ok) {
		throw new Error(`download failed for ${lang}: HTTP ${response.status}`);
	}
	const raw = Buffer.from(await response.arrayBuffer());
	writeFileSync(target, gzipSync(raw));
	console.log(`fetched + gzipped ${lang}.traineddata (${(raw.length / 1e6).toFixed(1)} MB raw)`);
}
console.log("done → assets/ocr/");
