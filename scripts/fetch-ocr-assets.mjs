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
 *
 * Everything downloaded here is PINNED and VERIFIED. The zip built from these
 * files is the thing users' machines fetch and then execute as a Web Worker,
 * so an unpinned upstream would make the checksum in assets.ts meaningless:
 * you would be faithfully verifying whatever the moving branch happened to
 * serve on build day.
 */
import { createHash } from "crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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

/** A commit, never a branch — `raw/main` would move under us between builds. */
const TESSDATA_COMMIT = "87416418657359cb625c412a48b6e1d6d41c29bd";
const TESSDATA_BASE = `https://github.com/tesseract-ocr/tessdata_fast/raw/${TESSDATA_COMMIT}`;

/** sha256 of the RAW traineddata at that commit, before gzip. */
const TESSDATA_SHA256 = {
	deu: "19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d",
	eng: "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2",
};

function sha256(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

for (const [lang, expected] of Object.entries(TESSDATA_SHA256)) {
	const target = path.join(OUT_DIR, `${lang}.traineddata.gz`);

	// A pre-existing file is only trusted if it verifies. The old "skip if
	// present" let a stale artifact from an earlier run end up inside a
	// release zip without anyone noticing.
	if (existsSync(target)) {
		const { gunzipSync } = await import("zlib");
		try {
			if (sha256(gunzipSync(readFileSync(target))) === expected) {
				console.log(`${target} already present and verified, skipping download`);
				continue;
			}
			console.log(`${target} present but does NOT verify — refetching`);
		} catch {
			console.log(`${target} present but unreadable — refetching`);
		}
	}

	const response = await fetch(`${TESSDATA_BASE}/${lang}.traineddata`);
	if (!response.ok) {
		throw new Error(`download failed for ${lang}: HTTP ${response.status}`);
	}
	const raw = Buffer.from(await response.arrayBuffer());
	const actual = sha256(raw);
	if (actual !== expected) {
		throw new Error(
			`checksum mismatch for ${lang}.traineddata\n  expected ${expected}\n  actual   ${actual}`,
		);
	}
	writeFileSync(target, gzipSync(raw));
	console.log(`fetched + verified + gzipped ${lang}.traineddata (${(raw.length / 1e6).toFixed(1)} MB raw)`);
}
console.log("done → assets/ocr/");
