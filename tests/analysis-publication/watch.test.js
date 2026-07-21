const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { startProjectAnalysisWatch, ignoredPath } = require('../../tools/lib/watch-project-analysis');

async function temporaryProject() {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'bif-analysis-watch-'));
  const root = path.join(parent, 'story');
  await fs.cp(path.join(process.cwd(), 'test-fixtures/authoring-graph/complete-project'), root, { recursive: true });
  return { parent, root };
}

async function waitFor(predicate, timeout = 5000) {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeout) throw new Error('Timed out waiting for watch update');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

test('watch publishes initially, updates Markdown, and ignores generated output', async () => {
  const { parent, root } = await temporaryProject();
  const results = [];
  let watcher;
  try {
    watcher = await startProjectAnalysisWatch(root, { debounceMs: 30, onResult: result => results.push(result) });
    assert.equal(results.length, 1);
    const initialHash = results[0].contentHash;
    await fs.writeFile(path.join(root, 'pages', '4.md'), '# New page\n', 'utf8');
    await waitFor(() => results.length >= 2);
    assert.notEqual(results.at(-1).contentHash, initialHash);
    const count = results.length;
    await fs.writeFile(path.join(root, '.story-tools', 'probe.md'), '# generated\n', 'utf8');
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(results.length, count);
  } finally {
    await watcher?.close();
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test('watch serializes a burst to one active publication and one bounded rerun', async () => {
  const { parent, root } = await temporaryProject();
  let active = 0;
  let maximumActive = 0;
  let calls = 0;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const publish = async () => {
    calls += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    if (calls === 2) await held;
    active -= 1;
    return { summary: {}, contentHash: `${calls}` };
  };
  let watcher;
  try {
    watcher = await startProjectAnalysisWatch(root, { publish, debounceMs: 10 });
    watcher.schedule();
    await waitFor(() => calls === 2);
    watcher.schedule(); watcher.schedule(); watcher.schedule();
    assert.equal(calls, 2);
    release();
    await waitFor(() => calls === 3);
    assert.equal(maximumActive, 1);
    assert.equal(calls, 3);
  } finally {
    release?.();
    await watcher?.close();
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test('watch exclusions cover generated, dependency, Git, and editor files', () => {
  const root = path.resolve('/tmp/story');
  assert.equal(ignoredPath(root, path.join(root, '.story-tools', 'analysis.json')), true);
  assert.equal(ignoredPath(root, path.join(root, 'node_modules', 'x.js')), true);
  assert.equal(ignoredPath(root, path.join(root, '.git', 'index')), true);
  assert.equal(ignoredPath(root, path.join(root, 'pages', '1.md~')), true);
  assert.equal(ignoredPath(root, path.join(root, 'pages', '1.md')), false);
});
