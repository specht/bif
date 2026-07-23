#!/usr/bin/env node
const path = require("node:path");
const { publishProjectAnalysis } = require("./lib/publish-project-analysis");
const { startProjectAnalysisWatch } = require("./lib/watch-project-analysis");

const USAGE = "Usage: npm run dev -- [--project PATH]";

function parseArguments(argv, cwd = process.cwd()) {
  const options = { project: path.resolve(cwd), help: false, watch: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--watch") options.watch = true;
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
    console.log(`${USAGE}\n\nPublishes .story-tools/analysis.json immediately and keeps it current. --watch is accepted for direct internal use.`);
    return 0;
  }
  try {
    if (options.watch) {
      const report = result => {
        console.log("Published .story-tools/analysis.json");
        console.log(`${result.summary.pages} pages · ${result.summary.choices} choices · ${result.summary.errors} errors · ${result.summary.warnings} warnings`);
        console.log(`SHA-256: ${result.contentHash}`);
      };
      const watcher = await startProjectAnalysisWatch(options.project, {
        onResult: report,
        onError: error => console.error(`Analysis publication failed (${error.code || 'watch-error'}): ${error.message}\nWatching for fixes…`),
      });
      console.log(`Watching ${options.project} for story changes…`);
      await new Promise(resolve => {
        let stopping = false;
        const stop = async () => {
          if (stopping) return;
          stopping = true;
          await watcher.close();
          console.log("Analysis watch stopped.");
          resolve();
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
      return 0;
    }
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
