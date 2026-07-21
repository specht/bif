const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { analyzeStory } = require("../../tools/lib/story-analyzer");
const {
  ProjectAnalysisError,
  publishProjectAnalysis,
} = require("../../tools/lib/publish-project-analysis");

const repository = path.resolve(__dirname, "../..");
const fixture = name => path.join(repository, "test-fixtures", "authoring-graph", name);

async function temporaryProject(source = fixture("complete-project")) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "bif-analysis-service-"));
  const root = path.join(parent, "story");
  await fs.cp(source, root, { recursive: true });
  await fs.rm(path.join(root, ".story-tools"), { recursive: true, force: true });
  return { parent, root };
}

test("shared service analyzes once and publishes the returned model", async () => {
  const { parent, root } = await temporaryProject();
  let analyses = 0;
  try {
    const result = await publishProjectAnalysis(root, {
      analyzeStory: async projectRoot => { analyses += 1; return analyzeStory(projectRoot); },
    });
    assert.equal(analyses, 1);
    assert.equal(result.published, true);
    assert.equal(result.stale, false);
    assert.equal(result.outputPath, path.join(root, ".story-tools", "analysis.json"));
    assert.deepEqual(JSON.parse(await fs.readFile(result.outputPath, "utf8")), result.publication);
    assert.equal(result.contentHash, result.publication.contentHash);
    assert.deepEqual(result.summary, result.publication.summary);
    assert.equal(result.analysis.summary.pages, result.summary.pages);
    assert.equal(result.publication.schemaVersion, 1);
    assert.ok(!result.serialized.includes(root));
    assert.ok(!result.serialized.includes("vscode://"));
    assert.ok(result.publication.diagnostics.every(item => !path.isAbsolute(item.file)));
    assert.ok(result.publication.nodes.some(node => node.kind === "missing" && node.pageId === "99"));
    assert.equal(result.publication.edges.filter(edge => edge.source === "1" && edge.target === "2").length, 2);
    assert.ok(result.publication.groups.some(group => group.name === "Missing targets"));
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("unchanged project publication has byte-identical JSON, hash, and summary", async () => {
  const { parent, root } = await temporaryProject();
  try {
    const first = await publishProjectAnalysis(root);
    const firstBytes = await fs.readFile(first.outputPath);
    const second = await publishProjectAnalysis(root);
    assert.deepEqual(await fs.readFile(second.outputPath), firstBytes);
    assert.equal(second.serialized, first.serialized);
    assert.equal(second.contentHash, first.contentHash);
    assert.deepEqual(second.summary, first.summary);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("changed project atomically replaces valid output without temporary files", async () => {
  const { parent, root } = await temporaryProject();
  try {
    const first = await publishProjectAnalysis(root);
    await fs.writeFile(path.join(root, "pages", "4.md"), "# Newly added page\n", "utf8");
    const second = await publishProjectAnalysis(root);
    assert.notEqual(second.contentHash, first.contentHash);
    assert.equal(JSON.parse(await fs.readFile(second.outputPath, "utf8")).contentHash, second.contentHash);
    assert.deepEqual((await fs.readdir(path.dirname(second.outputPath))).filter(name => name.startsWith(".analysis.")), []);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("publication failure preserves prior bytes and cleans its temporary file", async () => {
  const { parent, root } = await temporaryProject();
  try {
    const first = await publishProjectAnalysis(root);
    const previous = await fs.readFile(first.outputPath);
    await fs.writeFile(path.join(root, "pages", "4.md"), "# Changed\n", "utf8");
    await assert.rejects(
      publishProjectAnalysis(root, { beforeRename: async () => { throw new Error("simulated rename failure"); } }),
      error => error instanceof ProjectAnalysisError && error.code === "publication-failed" && /simulated rename failure/.test(error.cause?.message),
    );
    assert.deepEqual(await fs.readFile(first.outputPath), previous);
    assert.deepEqual((await fs.readdir(path.dirname(first.outputPath))).filter(name => name.startsWith(".analysis.")), []);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("stale currentness before writing or renaming never replaces output", async () => {
  const firstProject = await temporaryProject();
  try {
    const staleBeforeWrite = await publishProjectAnalysis(firstProject.root, { isCurrent: () => false });
    assert.equal(staleBeforeWrite.published, false);
    assert.equal(staleBeforeWrite.stale, true);
    await assert.rejects(fs.access(path.join(firstProject.root, ".story-tools", "analysis.json")));
  } finally {
    await fs.rm(firstProject.parent, { recursive: true, force: true });
  }

  const secondProject = await temporaryProject();
  try {
    const initial = await publishProjectAnalysis(secondProject.root);
    const previous = await fs.readFile(initial.outputPath);
    await fs.writeFile(path.join(secondProject.root, "pages", "4.md"), "# Changed\n", "utf8");
    let checks = 0;
    const staleBeforeRename = await publishProjectAnalysis(secondProject.root, {
      isCurrent: () => ++checks < 3,
    });
    assert.equal(staleBeforeRename.published, false);
    assert.equal(staleBeforeRename.stale, true);
    assert.deepEqual(await fs.readFile(initial.outputPath), previous);
    assert.deepEqual((await fs.readdir(path.dirname(initial.outputPath))).filter(name => name.startsWith(".analysis.")), []);
  } finally {
    await fs.rm(secondProject.parent, { recursive: true, force: true });
  }
});

test("service never executes story code and ignores generated Markdown", async () => {
  const { parent, root } = await temporaryProject();
  try {
    await fs.appendFile(path.join(root, "pages", "1.md"), "\n<script>globalThis.bifStoryCodeExecuted = true;</script>\n", "utf8");
    await fs.mkdir(path.join(root, ".story-tools"), { recursive: true });
    await fs.writeFile(path.join(root, ".story-tools", "rogue.md"), "# Not a story page\n", "utf8");
    delete globalThis.bifStoryCodeExecuted;
    const result = await publishProjectAnalysis(root);
    assert.equal(globalThis.bifStoryCodeExecuted, undefined);
    assert.ok(!result.serialized.includes("bifStoryCodeExecuted"));
    assert.ok(!result.publication.nodes.some(node => node.pageId === "rogue"));
  } finally {
    delete globalThis.bifStoryCodeExecuted;
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("hostile story text remains escaped, inert JSON data", async () => {
  const { parent, root } = await temporaryProject(fixture("escaping"));
  try {
    const result = await publishProjectAnalysis(root);
    assert.ok(!result.serialized.includes("</script>"));
    assert.ok(result.serialized.includes("\\u003c/script\\u003e"));
    assert.deepEqual(JSON.parse(result.serialized), result.publication);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("service returns structured project validation errors", async () => {
  const missing = path.join(os.tmpdir(), `bif-missing-${process.pid}-${Date.now()}`);
  await assert.rejects(publishProjectAnalysis(missing), error => error.code === "project-not-found");

  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "bif-analysis-invalid-"));
  try {
    const file = path.join(parent, "file");
    await fs.writeFile(file, "not a directory", "utf8");
    await assert.rejects(publishProjectAnalysis(file), error => error.code === "project-not-directory");
    await assert.rejects(publishProjectAnalysis(parent), error => error.code === "project-config-missing");
    await fs.writeFile(path.join(parent, "config.js"), "export const path = missingName;\n", "utf8");
    await assert.rejects(publishProjectAnalysis(parent), error => error.code === "project-config-invalid");
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});
