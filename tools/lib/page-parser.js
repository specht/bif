const MarkdownIt = require("markdown-it");
const markdownItAttrs = require("markdown-it-attrs");

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

function parsePage(source) {
  const links = [];
  const images = [];
  const conditions = [];
  const expressions = [];
  const scripts = [];
  const tokens = markdown.parse(source, {});
  let searchOffset = 0;

  for (const block of tokens) {
    const children = block.children || [];
    for (let index = 0; index < children.length; index += 1) {
      const token = children[index];
      if (token.type === "link_open") {
        const href = token.attrGet("href") || "";
        const text = [];
        for (let cursor = index + 1; cursor < children.length && children[cursor].type !== "link_close"; cursor += 1) text.push(children[cursor].content);
        const position = findPosition(source, `](${href}`, searchOffset);
        searchOffset = position.index + Math.max(href.length, 1);
        links.push({ target: href, text: text.join(""), label: token.attrGet("label"), condition: token.attrGet("condition"), line: position.line, column: position.column });
      }
      if (token.type === "image") {
        const src = token.attrGet("src") || "";
        const position = findPosition(source, src);
        images.push({ src, alt: token.content || "", line: position.line, column: position.column });
      }
    }
  }

  const rawLinkPattern = /<a\b([^>]*)>/gi;
  for (const match of source.matchAll(rawLinkPattern)) {
    const href = attribute(match[1], "href");
    if (href) links.push({ target: href, text: "", label: attribute(match[1], "label"), condition: attribute(match[1], "condition"), line: lineAt(source, match.index), column: 1 });
  }
  const rawImagePattern = /<img\b([^>]*)>/gi;
  for (const match of source.matchAll(rawImagePattern)) {
    const src = attribute(match[1], "src");
    if (src) images.push({ src, alt: attribute(match[1], "alt") || "", line: lineAt(source, match.index), column: 1 });
  }
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let scriptIndex = 0;
  for (const match of source.matchAll(scriptPattern)) {
    scriptIndex += 1;
    const contentOffset = match.index + match[0].indexOf(match[1]);
    scripts.push({ source: match[1], index: scriptIndex, line: lineAt(source, contentOffset), column: 1 });
  }
  const conditionPattern = /\bcondition\s*=\s*(["'])(.*?)\1/gis;
  for (const match of source.matchAll(conditionPattern)) {
    conditions.push({ source: match[2], line: lineAt(source, match.index), column: 1 });
  }
  const expressionAttributePattern = /\bexpression\s*=\s*(["'])(.*?)\1/gis;
  for (const match of source.matchAll(expressionAttributePattern)) {
    expressions.push({ source: match[2], line: lineAt(source, match.index), column: 1, syntax: "attribute" });
  }
  const inlineExpressionPattern = /\[\[\s*([\s\S]*?)\s*\]\]/g;
  for (const match of source.matchAll(inlineExpressionPattern)) {
    expressions.push({ source: match[1], line: lineAt(source, match.index), column: 1, syntax: "inline" });
  }

  return { metadata: parseMetadata(source), links, images, scripts, conditions, expressions };
}

module.exports = { parsePage };
