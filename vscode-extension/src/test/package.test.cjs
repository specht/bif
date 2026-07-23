const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");

const metadata = require(path.resolve("package.json"));
const vsix = path.resolve(`bif-authoring-tools-${metadata.version}.vsix`);
assert.ok(fs.existsSync(vsix), "VSIX exists");
const zip = new AdmZip(vsix);
const names = zip.getEntries().map(entry => entry.entryName);
const lowerNames = names.map(name => name.toLowerCase());
for (const required of ["extension/package.json", "extension/dist/extension.js", "extension/readme.md", "extension/changelog.md", "extension/license.txt", "extension/resources/icon.png"]) assert.ok(lowerNames.includes(required), `VSIX contains ${required}`);
assert.ok(!names.some(name => /(?:^|\/)(?:\.env|\.story-tools|node_modules|src|test-fixtures)(?:\/|$)/.test(name)), "generated, development, and secret-prone files are excluded");
assert.ok(!names.some(name => /\.(?:map|ts)$/.test(name)), "sources and maps are excluded");
const bundle = zip.readAsText("extension/dist/extension.js");
assert.match(bundle, /vscode-extension/);
assert.match(bundle, /Unsupported browser analysis schema/);
assert.ok(fs.statSync(vsix).size < 15 * 1024 * 1024, "package size is reasonable");
console.log(`${path.basename(vsix)}: ${fs.statSync(vsix).size} bytes, ${names.length} files`);
