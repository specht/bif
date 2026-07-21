#!/usr/bin/env node
const path = require("node:path");
const { analyzeStory } = require("./lib/story-analyzer");

function parseArguments(argv) {
  const result = { json: false, strict: false, project: path.resolve(__dirname, "..") };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") result.json = true;
    else if (argument === "--strict") result.strict = true;
    else if (argument === "--project" && argv[index + 1]) result.project = path.resolve(argv[++index]);
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown or incomplete option: ${argument}`);
  }
  return result;
}

function humanReport(result) {
  const lines = [`Checking story: ${result.project.title || "(untitled)"}`, `Pages directory: ${result.project.pagesPath}`, `Start page: ${result.project.startPage}`, "", `${result.summary.pages} pages; ${result.summary.links} links; ${result.summary.groups} groups`];
  for (const item of result.diagnostics) lines.push(`${item.file}:${item.line}:${item.column} ${item.severity} ${item.code}: ${item.message}`);
  lines.push(`${result.summary.errors} error(s), ${result.summary.warnings} warning(s)`, result.summary.errors ? "Story check failed." : "Story check passed.");
  return lines.join("\n");
}

async function main() {
  let options;
  try { options = parseArguments(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; return; }
  if (options.help) {
    console.log("Usage: node tools/check-story.js [--project PATH] [--json] [--strict]");
    return;
  }
  const result = await analyzeStory(options.project, options);
  console.log(options.json ? JSON.stringify(result, null, 2) : humanReport(result));
  if (result.summary.errors || (options.strict && result.summary.warnings)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Story analyzer failed: ${error.stack || error.message}`);
  process.exitCode = 2;
});
