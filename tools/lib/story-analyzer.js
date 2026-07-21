const fs = require("node:fs/promises");
const path = require("node:path");
const { readProjectConfig } = require("./project-config");
const { parsePage } = require("./page-parser");
const { checkExpression, checkScript } = require("./javascript-checker");
const { resolveStoryMetadata, FALLBACK_TITLE } = require("../../lib/story-metadata");

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
  let config;
  try {
    config = await readProjectConfig(root);
  } catch (error) {
    diagnostics.push(diagnostic("error", "config-error", "config.js", error.loc?.line || 1, (error.loc?.column || 0) + 1, error.message));
    return finish(root, { title: FALLBACK_TITLE, pagesPath: "", startPage: "1" }, [], [], diagnostics);
  }

  const pagesDirectory = path.resolve(root, config.pagesPath);
  for (const message of config.migrationWarnings || []) diagnostics.push(diagnostic("warning", "config-migration", "config.js", 1, 1, message));
  let storyTitle = FALLBACK_TITLE;
  if (!pagesDirectory.startsWith(`${root}${path.sep}`) && pagesDirectory !== root) {
    diagnostics.push(diagnostic("error", "pages-path-outside-project", "config.js", 1, 1, `Configured story path escapes the project: ${config.pagesPath}`));
    return finish(root, { ...config, title: FALLBACK_TITLE, startPage: "1" }, [], [], diagnostics);
  }

  let files;
  try {
    files = (await fs.readdir(pagesDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort(collator.compare);
  } catch (error) {
    diagnostics.push(diagnostic("error", "pages-path-missing", relative(root, pagesDirectory), 1, 1, `Cannot read configured story directory: ${error.message}`));
    return finish(root, { ...config, title: FALLBACK_TITLE, startPage: "1" }, [], [], diagnostics);
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
      pages.push({ id, filename, file, group: "", graphLabel: "", links: [], scripts: [], conditions: [], expressions: [], images: [] });
      continue;
    }
    if (id === "1") {
      const metadata = resolveStoryMetadata(source, { sourcePath: file });
      storyTitle = metadata.title;
      source = metadata.bodyMarkdown;
      for (const message of metadata.warnings) diagnostics.push(diagnostic("warning", "missing-story-title", file, 1, 1, message));
    }
    const parsed = parsePage(source);
    if (parsed.metadata.malformed) diagnostics.push(diagnostic("warning", "malformed-metadata", file, parsed.metadata.line, 1, "Graph metadata comment is malformed."));
    const page = {
      id,
      filename,
      file,
      group: parsed.metadata.group,
      graphLabel: parsed.metadata.summary,
      links: parsed.links,
      scripts: parsed.scripts,
      conditions: parsed.conditions,
      expressions: parsed.expressions,
      images: parsed.images,
    };
    pages.push(page);

    for (const link of parsed.links) {
      if (!isInternalTarget(link.target)) continue;
      edges.push({ source: id, target: link.target, text: link.text, label: link.label || null, condition: link.condition || null, file, line: link.line, column: link.column });
    }
    for (const script of parsed.scripts) {
      const error = checkScript(script.source);
      if (error) diagnostics.push(diagnostic("error", "script-syntax", file, script.line + (error.loc?.line || 1) - 1, (error.loc?.column || 0) + 1, error.message, { scriptIndex: script.index, source: script.source.trim() }));
    }
    for (const condition of parsed.conditions) {
      const error = checkExpression(condition.source);
      if (error) diagnostics.push(diagnostic("error", "condition-syntax", file, condition.line + Math.max((error.loc?.line || 1) - 1, 0), (error.loc?.column || 0) + 1, `Invalid condition '${condition.source}': ${error.message}`, { source: condition.source }));
    }
    for (const expression of parsed.expressions) {
      const error = checkExpression(expression.source);
      if (error) diagnostics.push(diagnostic("error", "expression-syntax", file, expression.line + Math.max((error.loc?.line || 1) - 1, 0), (error.loc?.column || 0) + 1, `Invalid expression '${expression.source}': ${error.message}`, { source: expression.source }));
    }
    for (const image of parsed.images) {
      if (/^(?:data:|https?:|\/\/)/i.test(image.src)) continue;
      let asset;
      try { asset = path.resolve(root, cleanAssetPath(image.src)); } catch {
        diagnostics.push(diagnostic("error", "invalid-image-path", file, image.line, image.column, `Invalid image path '${image.src}'.`));
        continue;
      }
      if (!asset.startsWith(`${root}${path.sep}`)) {
        diagnostics.push(diagnostic("error", "path-outside-project", file, image.line, image.column, `Image path escapes the project: ${image.src}`));
      } else {
        try { await fs.access(asset); } catch { diagnostics.push(diagnostic("error", "missing-image", file, image.line, image.column, `Image not found: ${image.src}`)); }
      }
      if (!image.alt.trim()) diagnostics.push(diagnostic("warning", "missing-image-alt", file, image.line, image.column, `Image has no alternative text: ${image.src}`));
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

  return finish(root, { ...config, title: storyTitle, startPage }, pages, edges, diagnostics, reachable.size);
}

function relative(root, value) {
  return path.relative(root, value).split(path.sep).join("/") || ".";
}

function finish(root, project, pages, edges, diagnostics, reachablePages = 0) {
  pages.sort((a, b) => collator.compare(a.id, b.id) || a.file.localeCompare(b.file));
  edges.sort((a, b) => collator.compare(a.source, b.source) || collator.compare(a.target, b.target) || a.line - b.line || a.column - b.column);
  diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || severityOrder[a.severity] - severityOrder[b.severity] || a.code.localeCompare(b.code));
  const counts = { errors: 0, warnings: 0, info: 0 };
  for (const item of diagnostics) counts[item.severity === "error" ? "errors" : item.severity === "warning" ? "warnings" : "info"] += 1;
  return {
    version: 1,
    project: { root: ".", title: project.title, pagesPath: project.pagesPath, startPage: project.startPage },
    summary: {
      pages: pages.length,
      reachablePages,
      unreachablePages: pages.length - reachablePages,
      links: edges.length,
      groups: new Set(pages.map((page) => page.group).filter(Boolean)).size,
      scripts: pages.reduce((sum, page) => sum + page.scripts.length, 0),
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
