const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { afterEach, test } = require("node:test");

const repository = path.resolve(__dirname, "../..");
const cli = path.join(repository, "tools", "publish-analysis.js");
const source = path.join(repository, "test-fixtures", "authoring-graph", "complete-project");
const temporaryDirectories = [];

function project() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "bif-analysis-cli-"));
  const root = path.join(parent, "story");
  fs.cpSync(source, root, { recursive: true });
  fs.rmSync(path.join(root, ".story-tools"), { recursive: true, force: true });
  temporaryDirectories.push(parent);
  return root;
}

function run(args, cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

test("CLI publishes the current-directory project", () => {
  const root = project();
  const result = run([], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Published \.story-tools\/analysis\.json/);
  assert.match(result.stdout, /3 pages .* 3 choices .* 2 errors .* 2 warnings/);
  assert.match(result.stdout, /SHA-256: [a-f0-9]{64}/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".story-tools", "analysis.json"), "utf8")).schemaVersion, 1);
});

test("CLI --project publishes from another working directory", () => {
  const root = project();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "bif-analysis-cwd-"));
  temporaryDirectories.push(elsewhere);
  const result = run(["--project", path.relative(elsewhere, root)], elsewhere);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(root, ".story-tools", "analysis.json")));
  assert.ok(!fs.existsSync(path.join(elsewhere, ".story-tools", "analysis.json")));
});

test("story diagnostics are reported but do not fail publication", () => {
  const root = project();
  const result = run(["--project", root], repository);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 errors/);
  assert.ok(fs.existsSync(path.join(root, ".story-tools", "analysis.json")));
});

test("invalid project fails without partial publication", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bif-analysis-not-project-"));
  temporaryDirectories.push(root);
  const result = run(["--project", root], repository);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /project-config-missing/);
  assert.ok(!fs.existsSync(path.join(root, ".story-tools", "analysis.json")));
});

test("help succeeds without accessing a project", () => {
  const nonProject = fs.mkdtempSync(path.join(os.tmpdir(), "bif-analysis-help-"));
  temporaryDirectories.push(nonProject);
  const result = run(["--help"], nonProject);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--project PATH/);
  assert.match(result.stdout, /--watch/);
});

test("unknown options fail with usage guidance", () => {
  const result = run(["--wat"], repository);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown option: --wat/);
  assert.match(result.stderr, /Try --help/);
});

test("--watch publishes, remains alive, updates, and shuts down cleanly", async () => {
  const root = project();
  const child = spawn(process.execPath, [cli, "--project", root, "--watch"], { cwd: repository, env: { ...process.env, NODE_TEST_CONTEXT: "" } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const waitFor = async predicate => {
    const started = Date.now();
    while (!predicate()) {
      if (Date.now() - started > 7000) throw new Error(`Timed out waiting for watch CLI\n${stdout}\n${stderr}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  await waitFor(() => stdout.includes("Watching "));
  const first = JSON.parse(fs.readFileSync(path.join(root, ".story-tools", "analysis.json"), "utf8"));
  fs.writeFileSync(path.join(root, "pages", "4.md"), "# Watched page\n", "utf8");
  await waitFor(() => JSON.parse(fs.readFileSync(path.join(root, ".story-tools", "analysis.json"), "utf8")).contentHash !== first.contentHash);
  child.kill("SIGINT");
  const code = await new Promise(resolve => child.once("exit", resolve));
  assert.equal(code, 0, stderr);
  assert.match(stdout, /Analysis watch stopped/);
});

test("missing --project value fails with usage guidance", () => {
  const result = run(["--project"], repository);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--project requires a path/);
  assert.match(result.stderr, /Try --help/);
});
