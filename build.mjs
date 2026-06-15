import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

// Main process (CommonJS, Node platform; electron stays external)
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
});

// Preload (CommonJS)
await build({
  entryPoints: ["src/preload.ts"],
  outfile: "dist/preload.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
});

// Renderer (browser; bundles transformers.js + cleanup)
await build({
  entryPoints: ["src/renderer.ts"],
  outfile: "dist/renderer.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome120",
});

copyFileSync("src/index.html", "dist/index.html");
copyFileSync("assets/jfk.wav", "dist/jfk.wav"); // sample for `npm run test:stt`

console.log("build ok");
