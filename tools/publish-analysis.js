#!/usr/bin/env node
const path = require("node:path");
const { publishProjectAnalysis } = require("./lib/publish-project-analysis");

const USAGE = "Usage: node tools/publish-analysis.js [--project PATH]";

function parseArguments(argv, cwd = process.cwd()) {
  const options = { project: path.resolve(cwd), help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--project") {
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error("--project requires a path");
      options.project = path.resolve(cwd, value);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    console.error(`${error.message}\n${USAGE}\nTry --help for usage.`);
    return 2;
  }
  if (options.help) {
    console.log(`${USAGE}\n\nPublishes <project>/.story-tools/analysis.json. Diagnostics do not make publication fail.`);
    return 0;
  }
  try {
    const result = await publishProjectAnalysis(options.project);
    console.log("Published .story-tools/analysis.json");
    console.log(`${result.summary.pages} pages · ${result.summary.choices} choices · ${result.summary.errors} errors · ${result.summary.warnings} warnings`);
    console.log(`SHA-256: ${result.contentHash}`);
    return 0;
  } catch (error) {
    const code = error?.code ? ` (${error.code})` : "";
    console.error(`Analysis publication failed${code}: ${error.message}`);
    return 1;
  }
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; });
}

module.exports = { main, parseArguments, USAGE };
