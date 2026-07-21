#!/usr/bin/env node
const fs = require("node:fs/promises");
const path = require("node:path");
const { analyzeStory } = require("./lib/story-analyzer");
const { buildAuthoringGraph } = require("./lib/authoring-graph-model");
const { generateDot, renderDot } = require("./lib/graphviz-dot");
const { generateHtml } = require("./lib/graph-html");

function parseArguments(argv) {
  const options = { project: path.resolve(__dirname, ".."), output: null, strict: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--project" && argv[index + 1]) options.project = path.resolve(argv[++index]);
    else if (argument === "--output" && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else if (argument === "--strict") options.strict = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown or incomplete option: ${argument}`);
  }
  options.output ||= path.join(options.project, ".story-tools", "graph.html");
  return options;
}

async function generateAuthoringGraph(options) {
  const analysis = await analyzeStory(options.project);
  const model = buildAuthoringGraph(analysis);
  const dot = generateDot(model);
  const svg = await renderDot(dot);
  const html = generateHtml({ model, svg, projectRoot: options.project });
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.writeFile(options.output, html, "utf8");
  return { analysis, model, dot, svg, html, output: options.output };
}

async function main() {
  let options;
  try { options = parseArguments(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; return; }
  if (options.help) { console.log("Usage: node tools/story-graph.js [--project PATH] [--output FILE] [--strict]"); return; }
  try {
    const result = await generateAuthoringGraph(options);
    console.log(`Authoring graph written: ${result.output}`);
    console.log(`${result.model.summary.pages} pages, ${result.model.summary.edges} choices, ${result.model.summary.missingTargets} missing targets, ${result.model.summary.errors} errors, ${result.model.summary.warnings} warnings`);
    if (result.model.summary.errors || (options.strict && result.model.summary.warnings)) process.exitCode = 1;
  } catch (error) {
    console.error(`Authoring graph failed: ${error.stack || error.message}`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = { generateAuthoringGraph, parseArguments };
