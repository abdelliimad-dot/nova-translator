import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const targetDir = path.join(rootDir, "public", "vad");

fs.mkdirSync(targetDir, { recursive: true });

const filesToCopy = [
  "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
  "node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx",
  "node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs",
];

for (const relPath of filesToCopy) {
  const src = path.join(rootDir, relPath);
  if (!fs.existsSync(src)) {
    console.warn(`Warning: VAD asset not found: ${relPath}`);
    continue;
  }
  const dest = path.join(targetDir, path.basename(src));
  fs.copyFileSync(src, dest);
  console.log(`Copied ${path.basename(src)} -> public/vad/`);
}
