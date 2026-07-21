const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const watch = process.argv.includes("--watch");
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile: "dist/extension.js",
  sourcemap: true,
  external: ["vscode"],
  logLevel: "info",
};

fs.mkdirSync("dist", { recursive: true });
fs.mkdirSync("resources", { recursive: true });
if (!fs.existsSync("resources/icon.png")) fs.copyFileSync(path.resolve("../favicon.png"), "resources/icon.png");

(async () => {
  if (watch) { const context = await esbuild.context(options); await context.watch(); }
  else await esbuild.build(options);
})().catch(error => { console.error(error); process.exit(1); });
