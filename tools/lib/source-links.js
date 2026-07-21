const path = require("node:path");

function sourceLocation(source) {
  return `${source.file}:${source.line || 1}:${source.column || 1}`;
}

function vscodeUri(projectRoot, source) {
  const absolute = path.resolve(projectRoot, source.file).split(path.sep).join("/");
  return `vscode://file/${encodeURI(absolute).replace(/#/g, "%23").replace(/\?/g, "%3F")}:${source.line || 1}:${source.column || 1}`;
}

module.exports = { sourceLocation, vscodeUri };
