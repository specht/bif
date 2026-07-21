const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");
const { runTests } = require("@vscode/test-electron");

(async () => {
  await esbuild.build({ entryPoints: ["src/test/integration/index.ts"], bundle: true, platform: "node", format: "cjs", target: "node18", outfile: "dist/test/index.js", external: ["vscode"] });
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bif-vscode-test-"));
  fs.cpSync(path.resolve("../test-fixtures/vscode-extension/workspace"), workspace, { recursive: true });
  try {
    await runTests({
      extensionDevelopmentPath: process.env.BIF_TEST_EXTENSION_PATH || path.resolve("."),
      extensionTestsPath: path.resolve("dist/test/index.js"),
      launchArgs: [workspace, "--disable-extensions"],
      extensionTestsEnv: { ELECTRON_RUN_AS_NODE: undefined, VSCODE_ESM_ENTRYPOINT: undefined },
    });
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
