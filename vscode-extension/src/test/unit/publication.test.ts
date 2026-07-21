import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const { analyzeStory } = require("../../../../tools/lib/story-analyzer") as { analyzeStory(root: string): Promise<any> };
const {
  buildBrowserAnalysisPublication,
  canonicalJson,
  publishBrowserAnalysis,
} = require("../../../../tools/lib/browser-analysis-publication") as {
  buildBrowserAnalysisPublication(analysis: any): any;
  canonicalJson(value: any): string;
  publishBrowserAnalysis(root: string, publication: any, generation: number, options?: any): Promise<{ output: string; published: boolean }>;
};

const repository = path.resolve(__dirname, "../../../..");
const fixture = (name: string) => path.join(repository, "test-fixtures/authoring-graph", name);

test("publication maps the complete authoring model without machine-specific or executable data", async () => {
  const publication = buildBrowserAnalysisPublication(await analyzeStory(fixture("complete-project")));
  assert.equal(publication.schemaVersion, 1);
  assert.equal(publication.project.startPage, "1");
  assert.equal(publication.summary.pages, 3);
  assert.equal(publication.summary.missingTargets, 1);
  assert.ok(publication.nodes.some((node: any) => node.kind === "missing" && node.pageId === "99"));
  assert.equal(publication.edges.filter((edge: any) => edge.source === "1" && edge.target === "2").length, 2);
  assert.ok(publication.groups.some((group: any) => group.name === "Missing targets"));
  assert.ok(publication.diagnostics.some((item: any) => item.code === "expression-syntax"));
  assert.ok(publication.edges.every((edge: any) => edge.file && edge.line > 0 && edge.column > 0));
  const json = canonicalJson(publication);
  assert.ok(!json.includes(repository));
  assert.ok(!json.includes("vscode://"));
  assert.ok(!json.includes("story-code-executed"));
  assert.ok(!publication.diagnostics.some((item: any) => "source" in item));
});

test("publication bytes and SHA-256 hash are deterministic and meaningful changes alter the hash", async () => {
  const analysis = await analyzeStory(fixture("complete-project"));
  const first = buildBrowserAnalysisPublication(analysis);
  const second = buildBrowserAnalysisPublication(analysis);
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(first.contentHash, second.contentHash);
  assert.match(first.contentHash, /^[a-f0-9]{64}$/);
  const changed = structuredClone(analysis);
  changed.project.title = `${changed.project.title} changed`;
  assert.notEqual(buildBrowserAnalysisPublication(changed).contentHash, first.contentHash);
});

test("hostile story text remains escaped JSON data and is never executed", async () => {
  const publication = buildBrowserAnalysisPublication(await analyzeStory(fixture("escaping")));
  const json = canonicalJson(publication);
  assert.ok(!json.includes("</script>"));
  assert.ok(json.includes("\\u003c/script\\u003e"));
  assert.deepEqual(JSON.parse(json).project, publication.project);
});

test("atomic publication creates and replaces valid JSON without leftover temporary files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bif-publication-"));
  try {
    const first = buildBrowserAnalysisPublication(await analyzeStory(fixture("complete-project")));
    const written = await publishBrowserAnalysis(root, first, 1);
    assert.equal(written.published, true);
    assert.deepEqual(JSON.parse(await fs.readFile(written.output, "utf8")), first);
    const second = { ...first, contentHash: "b".repeat(64) };
    await publishBrowserAnalysis(root, second, 2);
    assert.deepEqual(JSON.parse(await fs.readFile(written.output, "utf8")), second);
    assert.deepEqual((await fs.readdir(path.join(root, ".story-tools"))).sort(), ["analysis.json"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a failed or stale atomic publication preserves the previous bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bif-publication-failure-"));
  try {
    const publication = buildBrowserAnalysisPublication(await analyzeStory(fixture("complete-project")));
    const { output } = await publishBrowserAnalysis(root, publication, 1);
    const previous = await fs.readFile(output);
    await assert.rejects(publishBrowserAnalysis(root, { ...publication, contentHash: "c".repeat(64) }, 2, {
      beforeRename: async () => { throw new Error("simulated rename failure"); },
    }), /simulated rename failure/);
    assert.deepEqual(await fs.readFile(output), previous);
    const stale = await publishBrowserAnalysis(root, { ...publication, contentHash: "d".repeat(64) }, 3, {
      isCurrent: () => false,
    });
    assert.equal(stale.published, false);
    assert.deepEqual(await fs.readFile(output), previous);
    assert.deepEqual((await fs.readdir(path.dirname(output))).sort(), ["analysis.json"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
