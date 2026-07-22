const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");
const { analyzeStory } = require("../../tools/lib/story-analyzer");
const { normalizeAcornError } = require("../../tools/lib/javascript-checker");

const repository = path.resolve(__dirname, "../..");
const fixture = (name) => path.join(repository, "test-fixtures/analyzer", name);

test("valid story produces a stable graph with distinct repeated edges", async () => {
  const result = await analyzeStory(fixture("valid"));
  assert.equal(result.project.title, "Analyzer start");
  assert.equal(result.summary.errors, 0);
  assert.equal(result.summary.pages, 2);
  assert.equal(result.summary.links, 2);
  assert.equal(result.summary.reachablePages, 2);
  assert.equal(result.summary.scripts, 1);
  assert.equal(result.summary.conditions, 2);
  assert.equal(result.summary.expressions, 2);
  assert.deepEqual(result.graph.edges.map(({ source, target, text, label, condition }) => ({ source, target, text, label, condition })), [
    { source: "1", target: "2", text: "First route", label: "first", condition: "ready" },
    { source: "1", target: "2", text: "Second route", label: "second", condition: null },
  ]);
});

test("missing destinations and unreachable pages are diagnosed", async () => {
  const missing = await analyzeStory(fixture("missing-link"));
  const missingPage = missing.diagnostics.find((item) => item.code === "missing-page");
  assert.equal(missingPage?.target, "99");
  assert.equal(missingPage?.file, "pages/1.md");
  assert.ok(missingPage?.line > 0);
  const unreachable = await analyzeStory(fixture("unreachable"));
  assert.deepEqual(unreachable.graph.pages.map((page) => page.id), ["1", "2"]);
  assert.equal(unreachable.diagnostics.find((item) => item.code === "unreachable-page")?.file, "pages/2.md");
  const strict = await analyzeStory(fixture("unreachable"), { strict: true });
  assert.equal(strict.diagnostics.find((item) => item.code === "unreachable-page")?.severity, "warning");
});

test("real JavaScript parsing reports scripts, conditions, and expressions independently", async () => {
  const result = await analyzeStory(fixture("invalid-syntax"));
  const codes = result.diagnostics.map((item) => item.code);
  assert.ok(codes.includes("script-syntax"));
  assert.equal(codes.filter((code) => code === "script-syntax").length, 1);
  const script = result.diagnostics.find((item) => item.code === "script-syntax");
  assert.equal(script.message, "Unexpected token");
  assert.equal(script.scriptIndex, 1);
  assert.equal(script.scriptLine, 2);
  assert.ok(Number.isInteger(script.scriptColumn));
  assert.ok(Number.isInteger(script.line));
  assert.ok(Number.isInteger(script.column));
  assert.ok(codes.includes("condition-syntax"));
  assert.equal(codes.filter((code) => code === "expression-syntax").length, 2);
  for (const item of result.diagnostics) {
    assert.equal(item.file, "pages/1.md");
    assert.ok(item.line > 0);
  }
});

test("Acorn normalization removes only its own parser-location suffix", () => {
  assert.deepEqual(normalizeAcornError({ message: "Unexpected token (2:20)", loc: { line: 2, column: 20 } }), {
    message: "Unexpected token", line: 2, column: 20,
  });
  assert.deepEqual(normalizeAcornError({ message: "Expected token (because grouped)", loc: { line: 2, column: 20 } }), {
    message: "Expected token (because grouped)", line: 2, column: 20,
  });
});

test("Assigning to rvalue publishes a semantic message and structured local coordinates", async () => {
  const result = await analyzeStory(fixture("assigning-rvalue"));
  const item = result.diagnostics.find(diagnostic => diagnostic.code === "script-syntax");
  assert.equal(item.message, "Assigning to rvalue");
  assert.equal(item.file, "pages/1.md");
  assert.equal(item.line, 16);
  assert.equal(item.column, 22);
  assert.equal(item.scriptIndex, 1);
  assert.equal(item.scriptLine, 2);
  assert.equal(item.scriptColumn, 21);
  assert.doesNotMatch(item.message, /Script 1|\(2:21\)/);
});

test("local image existence, traversal, and missing alt text are checked", async () => {
  const result = await analyzeStory(fixture("missing-image"));
  assert.ok(result.diagnostics.some((item) => item.code === "missing-image" && item.message.includes("assets/missing.png")));
  assert.ok(result.diagnostics.some((item) => item.code === "path-outside-project"));
  assert.ok(result.diagnostics.some((item) => item.code === "missing-image-alt"));
  assert.ok(!result.diagnostics.some((item) => item.message.includes("example.test")));
});

test("case-insensitive page ID collisions are diagnosed", async () => {
  const result = await analyzeStory(fixture("collision"));
  assert.ok(result.diagnostics.some((item) => item.code === "case-collision"));
  assert.ok(result.diagnostics.some((item) => item.code === "ambiguous-target"));
});

test("the active story can be analyzed without executing story code", async () => {
  const result = await analyzeStory(repository);
  assert.equal(result.summary.pages, 13);
  assert.equal(result.summary.errors, 0);
});

test("CLI JSON is machine-readable and failures set a nonzero exit status", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const valid = spawnSync(process.execPath, ["tools/check-story.js", "--project", fixture("valid"), "--json"], { cwd: repository, encoding: "utf8", env });
  assert.ifError(valid.error);
  assert.equal(valid.status, 0, valid.stderr);
  const parsed = JSON.parse(valid.stdout);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.summary.pages, 2);
  const invalid = spawnSync(process.execPath, ["tools/check-story.js", "--project", fixture("missing-link"), "--json"], { cwd: repository, encoding: "utf8", env });
  assert.ifError(invalid.error);
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stdout).diagnostics[0].code, "missing-page");
  const warning = spawnSync(process.execPath, ["tools/check-story.js", "--project", fixture("unreachable")], { cwd: repository, encoding: "utf8", env });
  const strict = spawnSync(process.execPath, ["tools/check-story.js", "--project", fixture("unreachable"), "--strict"], { cwd: repository, encoding: "utf8", env });
  assert.equal(warning.status, 0);
  assert.equal(strict.status, 1);
});

test("analysis output is deterministic", async () => {
  const first = await analyzeStory(fixture("valid"));
  const second = await analyzeStory(fixture("valid"));
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});
