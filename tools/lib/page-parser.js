const MarkdownIt = require("markdown-it");
const markdownItAttrs = require("markdown-it-attrs");
const { classifyChoiceTarget, parseChoiceResults } = require("../../lib/choice-result-model");

const markdown = new MarkdownIt({ html: true }).use(markdownItAttrs);

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function attribute(source, name) {
  const match = source.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, "is"));
  return match?.[2] ?? null;
}

function findPosition(source, needle, from = 0) {
  const index = source.indexOf(needle, from);
  return index < 0 ? { index: from, line: lineAt(source, from), column: 1 } : {
    index,
    line: lineAt(source, index),
    column: index - source.lastIndexOf("\n", index - 1),
  };
}

function parseMetadata(source) {
  const detailed = source.match(/<!--\s*(.*?)\s*--\s*(.*?)\s*-->/s);
  if (detailed) return { group: detailed[1].trim(), summary: detailed[2].trim(), line: lineAt(source, detailed.index), malformed: !detailed[1].trim() };
  const simple = source.match(/<!--\s*(.*?)\s*-->/s);
  if (simple) return { group: simple[1].trim(), summary: "", line: lineAt(source, simple.index), malformed: !simple[1].trim() };
  const unterminated = source.indexOf("<!--");
  return { group: "", summary: "", line: unterminated < 0 ? 1 : lineAt(source, unterminated), malformed: unterminated >= 0 };
}

function collectSyntax(source, lineOffset = 0, extra = {}) {
  const images = [];
  const conditions = [];
  const expressions = [];
  const scripts = [];
  const unsupportedScripts = [];
  const tokens = markdown.parse(source, {});
  for (const block of tokens) {
    const children = block.children || [];
    for (const token of children) {
      if (token.type === "image") {
        const src = token.attrGet("src") || "";
        const position = findPosition(source, src);
        images.push({ src, alt: token.content || "", line: position.line + lineOffset, column: position.column, ...extra });
      }
    }
  }
  const rawImagePattern = /<img\b([^>]*)>/gi;
  for (const match of source.matchAll(rawImagePattern)) {
    const src = attribute(match[1], "src");
    if (src) images.push({ src, alt: attribute(match[1], "alt") || "", line: lineAt(source, match.index) + lineOffset, column: 1, ...extra });
  }
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let scriptIndex = 0;
  for (const match of source.matchAll(scriptPattern)) {
    scriptIndex += 1;
    const contentOffset = match.index + match[0].indexOf(match[1]);
    scripts.push({ source: match[1], index: scriptIndex, line: lineAt(source, contentOffset) + lineOffset, column: 1, ...extra });
    const opening = match[0].slice(0, match[0].indexOf('>') + 1);
    if (/\bsrc\s*=/i.test(opening)) unsupportedScripts.push({ kind: "external", line: lineAt(source, match.index) + lineOffset, column: 1, ...extra });
    if (/\btype\s*=\s*(["'])module\1/i.test(opening)) unsupportedScripts.push({ kind: "module", line: lineAt(source, match.index) + lineOffset, column: 1, ...extra });
  }
  const conditionPattern = /\bcondition\s*=\s*(["'])(.*?)\1/gis;
  for (const match of source.matchAll(conditionPattern)) {
    conditions.push({ source: match[2], line: lineAt(source, match.index) + lineOffset, column: 1, ...extra });
  }
  const expressionAttributePattern = /\bexpression\s*=\s*(["'])(.*?)\1/gis;
  for (const match of source.matchAll(expressionAttributePattern)) {
    expressions.push({ source: match[2], line: lineAt(source, match.index) + lineOffset, column: 1, syntax: "attribute", ...extra });
  }
  const inlineExpressionPattern = /\[\[\s*([\s\S]*?)\s*\]\]/g;
  for (const match of source.matchAll(inlineExpressionPattern)) {
    expressions.push({ source: match[1], line: lineAt(source, match.index) + lineOffset, column: 1, syntax: "inline", ...extra });
  }
  return { images, scripts, unsupportedScripts, conditions, expressions };
}

function parsePage(source, { pageId = "" } = {}) {
  const tokens = markdown.parse(source, {});
  const choices = parseChoiceResults(source, tokens, pageId);
  const lines = source.split("\n");
  const pageLines = [...lines];
  for (const choice of choices) {
    if (!choice.hasResult) continue;
    for (let line = choice.resultStartLine - 1; line < choice.resultEndLine; line += 1) pageLines[line] = "";
  }
  const pageSyntax = collectSyntax(pageLines.join("\n"));
  const links = choices.map(choice => ({
    kind: choice.kind, target: choice.target, rawTarget: choice.rawTarget,
    text: choice.text, label: choice.label, condition: choice.condition,
    line: choice.line, column: 1, choiceId: choice.identity, local: choice.local,
    resultStartLine: choice.resultStartLine, resultEndLine: choice.resultEndLine,
    resultScriptCount: 0, hasVisibleResult: false, hasResult: choice.hasResult,
  }));
  let fallbackOrdinal = choices.length;
  for (const token of tokens) {
    if (token.type !== "inline") continue;
    const line = (token.map?.[0] ?? 0) + 1;
    for (let index = 0; index < (token.children || []).length; index += 1) {
      const child = token.children[index];
      if (child.type !== "link_open") continue;
      const rawTarget = child.attrGet("href") || "";
      if (!rawTarget || rawTarget.startsWith("#") || rawTarget.includes("/") || /^[a-z][a-z\d+.-]*:/i.test(rawTarget)) continue;
      const classifiedTarget = classifyChoiceTarget(rawTarget);
      if (links.some(link => link.line === line && link.rawTarget === rawTarget)) continue;
      const text = [];
      for (let cursor = index + 1; cursor < token.children.length && token.children[cursor].type !== "link_close"; cursor += 1) text.push(token.children[cursor].content);
      fallbackOrdinal += 1;
      links.push({
        ...classifiedTarget, text: text.join(""), label: child.attrGet("label"), condition: child.attrGet("condition"),
        line, column: 1, choiceId: `choice-${encodeURIComponent(String(pageId))}-${line}-${fallbackOrdinal}`,
        local: classifiedTarget.kind === "local", resultStartLine: null, resultEndLine: null,
        resultScriptCount: 0, hasVisibleResult: false, hasResult: false,
      });
    }
  }
  const resultBlocks = [];
  for (const choice of choices) {
    const offset = (choice.resultStartLine || choice.line) - 1;
    const syntax = collectSyntax(choice.resultMarkdown, offset, { choiceId: choice.identity, result: true });
    const visibleSource = choice.resultMarkdown.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "").trim();
    const link = links.find(item => item.choiceId === choice.identity);
    link.resultScriptCount = syntax.scripts.length;
    link.hasVisibleResult = visibleSource.length > 0;
    resultBlocks.push({ ...choice, ...syntax, hasVisibleResult: visibleSource.length > 0 });
  }
  return {
    metadata: parseMetadata(source), links, choices: links, resultBlocks,
    images: [...pageSyntax.images, ...resultBlocks.flatMap(block => block.images)],
    scripts: [...pageSyntax.scripts, ...resultBlocks.flatMap(block => block.scripts)],
    pageScripts: pageSyntax.scripts,
    resultScripts: resultBlocks.flatMap(block => block.scripts),
    unsupportedScripts: [...pageSyntax.unsupportedScripts, ...resultBlocks.flatMap(block => block.unsupportedScripts)],
    conditions: [...pageSyntax.conditions, ...resultBlocks.flatMap(block => block.conditions)],
    expressions: [...pageSyntax.expressions, ...resultBlocks.flatMap(block => block.expressions)],
  };
}

module.exports = { parsePage };
