const fs = require("node:fs/promises");
const path = require("node:path");
const { analyzeStory } = require("./story-analyzer");
const { buildBrowserAnalysisPublication, canonicalJson } = require("./browser-analysis-publication");

let temporarySequence = 0;

class ProjectAnalysisError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "ProjectAnalysisError";
    this.code = code;
    this.projectRoot = options.projectRoot;
  }
}

function errorFor(code, message, projectRoot, cause) {
  return new ProjectAnalysisError(code, message, { projectRoot, cause });
}

async function validateProjectRoot(projectRoot, fileSystem = fs) {
  const root = path.resolve(projectRoot || process.cwd());
  let stats;
  try {
    stats = await fileSystem.stat(root);
  } catch (cause) {
    const code = cause?.code === "ENOENT" ? "project-not-found" : "project-unreadable";
    throw errorFor(code, `Cannot access project directory: ${root}`, root, cause);
  }
  if (!stats.isDirectory()) {
    throw errorFor("project-not-directory", `Project path is not a directory: ${root}`, root);
  }
  const configPath = path.join(root, "config.js");
  try {
    const configStats = await fileSystem.stat(configPath);
    if (!configStats.isFile()) throw errorFor("project-config-missing", `BIF project config is not a file: ${configPath}`, root);
  } catch (cause) {
    if (cause instanceof ProjectAnalysisError) throw cause;
    const code = cause?.code === "ENOENT" ? "project-config-missing" : "project-unreadable";
    throw errorFor(code, `Cannot access BIF project config: ${configPath}`, root, cause);
  }
  return root;
}

function current(options) {
  return !options.isCurrent || options.isCurrent();
}

async function writeAnalysisAtomically(projectRoot, serialized, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const directory = path.join(projectRoot, ".story-tools");
  const outputPath = path.join(directory, "analysis.json");
  if (!current(options)) return { outputPath, published: false, stale: true };
  await fileSystem.mkdir(directory, { recursive: true });
  const generation = `${options.generation ?? "direct"}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const temporaryPath = path.join(directory, `.analysis.${process.pid}.${generation}.${++temporarySequence}.tmp`);
  let handle;
  try {
    handle = await fileSystem.open(temporaryPath, "wx");
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (!current(options)) return { outputPath, published: false, stale: true };
    if (options.beforeRename) await options.beforeRename({ temporaryPath, outputPath });
    if (!current(options)) return { outputPath, published: false, stale: true };
    await fileSystem.rename(temporaryPath, outputPath);
    return { outputPath, published: true, stale: false };
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fileSystem.unlink(temporaryPath).catch(error => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function publishProjectAnalysis(projectRoot = process.cwd(), options = {}) {
  const fileSystem = options.fileSystem || fs;
  const root = await validateProjectRoot(projectRoot, fileSystem);
  let analysis;
  try {
    analysis = await (options.analyzeStory || analyzeStory)(root);
  } catch (cause) {
    throw errorFor("analysis-failed", `Story analysis failed for ${root}`, root, cause);
  }
  const configError = analysis.diagnostics?.find(item => item.code === "config-error");
  if (configError) {
    throw errorFor("project-config-invalid", `Invalid BIF project config: ${configError.message}`, root);
  }

  let publication;
  let serialized;
  try {
    publication = (options.buildPublication || buildBrowserAnalysisPublication)(analysis);
    serialized = canonicalJson(publication);
  } catch (cause) {
    throw errorFor("publication-invalid", `Could not build analysis publication for ${root}`, root, cause);
  }

  const baseResult = {
    projectRoot: root,
    analysis,
    publication,
    serialized,
    contentHash: publication.contentHash,
    analysisHash: publication.analysisHash,
    summary: publication.summary,
    outputPath: path.join(root, ".story-tools", "analysis.json"),
  };
  if (!current(options)) return { ...baseResult, published: false, stale: true };
  try {
    const written = await writeAnalysisAtomically(root, serialized, options);
    return { ...baseResult, ...written };
  } catch (cause) {
    throw errorFor("publication-failed", `Could not publish .story-tools/analysis.json for ${root}`, root, cause);
  }
}

module.exports = {
  ProjectAnalysisError,
  publishProjectAnalysis,
  validateProjectRoot,
  writeAnalysisAtomically,
};
