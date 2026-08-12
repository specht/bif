const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { readProjectConfig } = require("./project-config");
const { parsePage } = require("./page-parser");
const { checkExpression, checkScript } = require("./javascript-checker");
const { resolveStoryMetadata, FALLBACK_TITLE } = require("../../runtime/modules/story-metadata");

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const severityOrder = { error: 0, warning: 1, info: 2 };

function diagnostic(severity, code, file, line, column, message, extra = {}) {
  return { severity, code, file, line, column, message, ...extra };
}

function isInternalTarget(target) {
  return Boolean(target) && !target.startsWith("#") && !target.includes("/") && !/^[a-z][a-z\d+.-]*:/i.test(target);
}

function cleanAssetPath(src) {
  return decodeURIComponent(src.split(/[?#]/, 1)[0]).replace(/^\/+/, "");
}

async function analyzeStory(projectRoot = process.cwd(), options = {}) {
  const root = path.resolve(projectRoot);
  const diagnostics = [];
  const sourceEntries = [];
  const manifestEntries = new Map();
  try {
    const bytes = await fs.readFile(path.join(root, "config.js"));
    sourceEntries.push(["config.js", bytes.toString("utf8")]);
    manifestEntries.set("config.js", hashBytes(bytes));
  } catch {}
  let config;
  try {
    config = await readProjectConfig(root);
  } catch (error) {
    diagnostics.push(diagnostic("error", "config-error", "config.js", error.loc?.line || 1, (error.loc?.column || 0) + 1, error.message));
    return finish(root, { title: FALLBACK_TITLE, pagesPath: "", startPage: "1" }, [], [], diagnostics, 0, sourceEntries, manifestEntries);
  }

  const pagesDirectory = path.resolve(root, config.pagesPath);
  const pagesPathLocation = config.pagesPathLocation || { line: 1, column: 1 };
  let storyTitle = FALLBACK_TITLE;
  if (!pagesDirectory.startsWith(`${root}${path.sep}`) && pagesDirectory !== root) {
    diagnostics.push(diagnostic("error", "pages-path-outside-project", "config.js", pagesPathLocation.line, pagesPathLocation.column, `Configured story path escapes the project: ${config.pagesPath}`, pagesPathLocation));
    return finish(root, { ...config, title: FALLBACK_TITLE, startPage: "1" }, [], [], diagnostics, 0, sourceEntries, manifestEntries);
  }

  let files;
  try {
    files = (await fs.readdir(pagesDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort(collator.compare);
  } catch (error) {
    const message = error?.code === "ENOENT"
      ? `Configured story directory does not exist: ${config.pagesPath}`
      : error?.code === "ENOTDIR"
        ? `Configured story path is not a directory: ${config.pagesPath}`
        : `Cannot read configured story directory '${config.pagesPath}': ${error.message}`;
    diagnostics.push(diagnostic("error", "pages-path-missing", "config.js", pagesPathLocation.line, pagesPathLocation.column, message, pagesPathLocation));
    return finish(root, { ...config, title: FALLBACK_TITLE, startPage: "1" }, [], [], diagnostics, 0, sourceEntries, manifestEntries);
  }

  const pages = [];
  const edges = [];
  const normalizedIds = new Map();
  for (const filename of files) {
    const id = filename.replace(/\.md$/i, "");
    const filePath = path.join(pagesDirectory, filename);
    const file = relative(root, filePath);
    const normalized = id.toLocaleLowerCase("en");
    if (normalizedIds.has(normalized)) {
      diagnostics.push(diagnostic("error", "case-collision", file, 1, 1, `Page ID '${id}' collides with '${normalizedIds.get(normalized)}' when case is ignored.`));
    } else normalizedIds.set(normalized, id);

    let source;
    try { source = await fs.readFile(filePath, "utf8"); }
    catch (error) {
      diagnostics.push(diagnostic("error", "file-read-error", file, 1, 1, `Cannot read page: ${error.message}`));
      pages.push({ id, filename, file, group: "", graphLabel: "", links: [], choices: [], resultBlocks: [], scripts: [], pageScripts: [], resultScripts: [], conditions: [], expressions: [], images: [] });
      continue;
    }
    sourceEntries.push([file, source]);
    manifestEntries.set(file, hashBytes(Buffer.from(source)));
    if (id === "1") {
      const metadata = resolveStoryMetadata(source, { sourcePath: file });
      storyTitle = metadata.title;
      source = metadata.bodyMarkdown;
      for (const message of metadata.warnings) diagnostics.push(diagnostic("warning", "missing-story-title", file, 1, 1, message));
    }
    const parsed = parsePage(source, { pageId: id });
    if (parsed.metadata.malformed) diagnostics.push(diagnostic("warning", "malformed-metadata", file, parsed.metadata.line, 1, "Graph metadata comment is malformed."));
    const page = {
      id,
      filename,
      file,
      group: parsed.metadata.group,
      graphLabel: parsed.metadata.summary,
      links: parsed.links,
      choices: parsed.choices,
      resultBlocks: parsed.resultBlocks,
      scripts: parsed.scripts,
      pageScripts: parsed.pageScripts,
      resultScripts: parsed.resultScripts,
      unsupportedScripts: parsed.unsupportedScripts,
      conditions: parsed.conditions,
      expressions: parsed.expressions,
      images: parsed.images,
      resources: parsed.resources,
    };
    pages.push(page);

    for (const link of parsed.links) {
      if (link.kind === "local" || link.local) continue;
      if (!isInternalTarget(link.target)) continue;
      edges.push({ source: id, target: link.target, text: link.text, label: link.label || null, condition: link.condition || null, file, line: link.line, column: link.column, choiceId: link.choiceId, resultScriptCount: link.resultScriptCount, hasVisibleResult: link.hasVisibleResult });
    }
    for (const choice of parsed.choices) {
      if (choice.local && !choice.hasVisibleResult && choice.resultScriptCount === 0) {
        diagnostics.push(diagnostic("warning", "local-choice-no-op", file, choice.line, choice.column, "A local choice has no result content or script and will not visibly change the page.", { choiceId: choice.choiceId }));
      }
    }
    for (const result of parsed.resultBlocks) {
      if (result.nestedChoices.length) diagnostics.push(diagnostic("error", "nested-result-choice", file, result.resultStartLine || result.line, 1, "Story choices cannot be nested inside a choice result. Put the follow-up question at the top level and use a condition.", { choiceId: result.identity }));
    }
    for (const script of parsed.unsupportedScripts) {
      const message = script.kind === "module"
        ? "Module scripts are not supported. Use a normal inline script."
        : "External script sources are not supported. Put story code in an inline script.";
      diagnostics.push(diagnostic("error", "unsupported-script", file, script.line, script.column, message, { choiceId: script.choiceId }));
    }
    for (const script of parsed.scripts) {
      const error = checkScript(script.source);
      if (error) diagnostics.push(diagnostic("error", "script-syntax", file, script.line + (error.line || 1) - 1, (error.column || 0) + 1, error.message, { scriptIndex: script.index, scriptLine: error.line, scriptColumn: error.column, source: script.source.trim() }));
    }
    for (const condition of parsed.conditions) {
      const error = checkExpression(condition.source);
      if (error) diagnostics.push(diagnostic("error", "condition-syntax", file, condition.line + Math.max((error.line || 1) - 1, 0), (error.column || 0) + 1, `Invalid condition '${condition.source}': ${error.message}`, { expressionLine: error.line, expressionColumn: error.column, source: condition.source }));
    }
    for (const expression of parsed.expressions) {
      const error = checkExpression(expression.source);
      if (error) diagnostics.push(diagnostic("error", "expression-syntax", file, expression.line + Math.max((error.line || 1) - 1, 0), (error.column || 0) + 1, `Invalid expression '${expression.source}': ${error.message}`, { expressionLine: error.line, expressionColumn: error.column, source: expression.source }));
    }
    for (const resource of parsed.resources) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/i.test(resource.src)) continue;
      let asset;
      try { asset = path.resolve(pagesDirectory, cleanAssetPath(resource.src)); } catch {
        diagnostics.push(diagnostic("error", "invalid-asset-path", file, resource.line, resource.column, `Invalid asset path '${resource.src}'.`));
        continue;
      }
      if (asset !== pagesDirectory && !asset.startsWith(`${pagesDirectory}${path.sep}`)) {
        diagnostics.push(diagnostic("error", "asset-outside-story", file, resource.line, resource.column, `Story asset path escapes the configured story directory: ${resource.src}`));
      } else {
        try {
          const bytes = await fs.readFile(asset);
          manifestEntries.set(relative(root, asset), hashBytes(bytes));
        } catch {
          const code = resource.tag === "img" ? "missing-image" : "missing-asset";
          diagnostics.push(diagnostic("error", code, file, resource.line, resource.column, `Story asset not found: ${resource.src}`));
        }
      }
      if (resource.tag === "img" && !resource.alt.trim()) diagnostics.push(diagnostic("warning", "missing-image-alt", file, resource.line, resource.column, `Image has no alternative text: ${resource.src}`));
    }
  }

  const ids = new Set(pages.map((page) => page.id));
  const idsByCase = new Map();
  for (const id of ids) {
    const key = id.toLocaleLowerCase("en");
    idsByCase.set(key, [...(idsByCase.get(key) || []), id]);
  }
  for (const edge of edges) {
    if (!ids.has(edge.target)) diagnostics.push(diagnostic("error", "missing-page", edge.file, edge.line, edge.column, `Choice '${edge.text || edge.target}' links to missing page '${edge.target}' (expected ${edge.target}.md).`, { target: edge.target }));
    if ((idsByCase.get(edge.target.toLocaleLowerCase("en")) || []).length > 1) diagnostics.push(diagnostic("error", "ambiguous-target", edge.file, edge.line, edge.column, `Target '${edge.target}' is ambiguous because page IDs differ only by case.`, { target: edge.target }));
  }
  const startPage = ids.has("1") ? "1" : pages[0]?.id || "1";
  if (!ids.has("1")) diagnostics.push(diagnostic("error", "missing-start-page", relative(root, pagesDirectory), 1, 1, "Configured story has no 1.md start page."));
  const reachable = new Set();
  const pending = ids.has(startPage) ? [startPage] : [];
  while (pending.length) {
    const current = pending.shift();
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const edge of edges) if (edge.source === current && ids.has(edge.target)) pending.push(edge.target);
  }
  for (const page of pages) {
    if (!reachable.has(page.id)) diagnostics.push(diagnostic("warning", "unreachable-page", page.file, 1, 1, `Page '${page.id}' is unreachable from page '${startPage}'.`));
  }

  return finish(root, { ...config, title: storyTitle, startPage }, pages, edges, diagnostics, reachable.size, sourceEntries, manifestEntries);
}

function hashBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function relative(root, value) {
  return path.relative(root, value).split(path.sep).join("/") || ".";
}

function finish(root, project, pages, edges, diagnostics, reachablePages = 0, sourceEntries = [], manifestEntries = new Map()) {
  pages.sort((a, b) => collator.compare(a.id, b.id) || a.file.localeCompare(b.file));
  edges.sort((a, b) => collator.compare(a.source, b.source) || collator.compare(a.target, b.target) || a.line - b.line || a.column - b.column);
  diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || severityOrder[a.severity] - severityOrder[b.severity] || a.code.localeCompare(b.code));
  const counts = { errors: 0, warnings: 0, info: 0 };
  for (const item of diagnostics) counts[item.severity === "error" ? "errors" : item.severity === "warning" ? "warnings" : "info"] += 1;
  return {
    version: 1,
    contentHash: crypto.createHash("sha256").update(JSON.stringify(sourceEntries)).digest("hex"),
    inputManifest: [...manifestEntries].sort(([a], [b]) => a.localeCompare(b)).map(([file, sha256]) => ({ path: file, sha256 })),
    project: { root: ".", title: project.title, pagesPath: project.pagesPath, startPage: project.startPage },
    summary: {
      pages: pages.length,
      reachablePages,
      unreachablePages: pages.length - reachablePages,
      links: edges.length,
      groups: new Set(pages.map((page) => page.group).filter(Boolean)).size,
      scripts: pages.reduce((sum, page) => sum + page.scripts.length, 0),
      pageScripts: pages.reduce((sum, page) => sum + page.pageScripts.length, 0),
      resultScripts: pages.reduce((sum, page) => sum + page.resultScripts.length, 0),
      pageChoices: edges.length,
      localChoices: pages.reduce((sum, page) => sum + page.choices.filter(choice => choice.local).length, 0),
      resultBlocks: pages.reduce((sum, page) => sum + page.resultBlocks.filter(block => block.hasResult).length, 0),
      conditions: pages.reduce((sum, page) => sum + page.conditions.length, 0),
      expressions: pages.reduce((sum, page) => sum + page.expressions.length, 0),
      images: pages.reduce((sum, page) => sum + page.images.length, 0),
      ...counts,
    },
    diagnostics,
    graph: { pages, edges },
  };
}

module.exports = { analyzeStory, isInternalTarget };
