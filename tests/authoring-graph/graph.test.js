const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { analyzeStory } = require("../../tools/lib/story-analyzer");
const { buildAuthoringGraph } = require("../../tools/lib/authoring-graph-model");
const { generateDot, renderDot } = require("../../tools/lib/graphviz-dot");
const { generateAuthoringGraph } = require("../../tools/story-graph");

const repository = path.resolve(__dirname, "../..");
const complete = path.join(repository, "test-fixtures/authoring-graph/complete-project");
const escaping = path.join(repository, "test-fixtures/authoring-graph/escaping");

async function modelFor(project = complete) { return buildAuthoringGraph(await analyzeStory(project)); }

test("complete graph model retains pages, groups, diagnostics, and a missing node", async () => {
  const model = await modelFor();
  assert.equal(model.nodes.filter((node) => node.kind === "page").length, 3);
  assert.ok(model.nodes.some((node) => node.pageId === "3" && !node.reachable));
  assert.ok(model.nodes.some((node) => node.kind === "missing" && node.pageId === "99"));
  assert.deepEqual(model.groups.map((group) => group.name), ["Harbor", "Mountain", "Missing targets"]);
  assert.ok(model.nodes.find((node) => node.pageId === "1").start);
  assert.equal(model.summary.errors, 2);
  assert.equal(model.summary.warnings, 2);
});

test("parallel edges retain distinct stable identities and metadata", async () => {
  const model = await modelFor();
  const parallel = model.edges.filter((edge) => edge.source === "1" && edge.target === "2");
  assert.equal(parallel.length, 2);
  assert.notEqual(parallel[0].edgeId, parallel[1].edgeId);
  assert.deepEqual(parallel.map((edge) => [edge.text, edge.label, edge.condition, edge.line]), [
    ["Take the bright road", "Bright road", null, 8],
    ["Take the guarded road", "Guarded road", "has_key", 9],
  ]);
});

test("diagnostics attach to pages, missing nodes, and broken edges", async () => {
  const model = await modelFor();
  assert.ok(model.nodes.find((node) => node.pageId === "1").diagnostics.some((item) => item.code === "expression-syntax"));
  assert.ok(model.nodes.find((node) => node.kind === "missing").diagnostics.some((item) => item.code === "missing-page"));
  assert.ok(model.edges.find((edge) => edge.broken).diagnostics.some((item) => item.code === "missing-page"));
  assert.equal(model.diagnostics.filter((item) => item.severity === "error").length, model.summary.errors);
});

test("DOT escapes hostile labels and renders through portable Graphviz", async () => {
  const dot = generateDot(await modelFor(escaping));
  assert.match(dot, /Äneas/);
  assert.match(dot, /\\</);
  assert.match(dot, /\\"/);
  const svg = await renderDot(dot);
  assert.match(svg, /<svg[\s>]/);
  assert.match(svg, /node(?:-|&#45;)page/);
});

test("view model and DOT output are deterministic", async () => {
  const first = await modelFor();
  const second = await modelFor();
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(generateDot(first), generateDot(second));
});

test("generated HTML is standalone and embeds JSON safely", async () => {
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "story-graph-")), "graph.html");
  const result = await generateAuthoringGraph({ project: escaping, output });
  assert.ok(fs.existsSync(output));
  assert.match(result.html, /<svg[\s>]/);
  assert.match(result.html, /<style>/);
  assert.match(result.html, /<script id="graph-data" type="application\/json">/);
  assert.doesNotMatch(result.html, /<(?:script|link)[^>]+(?:src|href)=["']https?:/i);
  assert.doesNotMatch(result.html, /\bfetch\s*\(/);
  assert.doesNotMatch(result.html, /generation timestamp/i);
  assert.doesNotMatch(result.html, /<div id="injected">/);
  assert.match(result.html, /\\u003c\/script\\u003e/);
});

test("CLI writes graphs on success and analyzer error with matching exit codes", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "story-graph-cli-"));
  const validOutput = path.join(directory, "valid.html");
  const brokenOutput = path.join(directory, "broken.html");
  const valid = spawnSync(process.execPath, ["tools/story-graph.js", "--project", path.join(repository, "test-fixtures/analyzer/valid"), "--output", validOutput], { cwd: repository, encoding: "utf8", env });
  assert.ifError(valid.error); assert.equal(valid.status, 0, valid.stderr); assert.ok(fs.existsSync(validOutput)); assert.match(valid.stdout, /Authoring graph written/);
  const broken = spawnSync(process.execPath, ["tools/story-graph.js", "--project", path.join(repository, "test-fixtures/analyzer/missing-link"), "--output", brokenOutput], { cwd: repository, encoding: "utf8", env });
  assert.ifError(broken.error); assert.equal(broken.status, 1, broken.stderr); assert.ok(fs.existsSync(brokenOutput));
  const html = fs.readFileSync(brokenOutput, "utf8"); assert.match(html, /node-missing-/); assert.match(html, /missing-page/);
});

test("active story graph matches its analyzer baseline", async () => {
  const analysis = await analyzeStory(repository);
  const model = buildAuthoringGraph(analysis);
  assert.equal(model.summary.pages, analysis.summary.pages);
  assert.equal(model.summary.edges, analysis.summary.links);
  assert.equal(model.summary.groups, analysis.summary.groups);
  assert.equal(model.summary.warnings, analysis.summary.warnings);
  assert.equal(model.summary.missingTargets, 0);
});
