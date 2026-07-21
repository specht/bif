import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GenerationScheduler,
  isGeneratedFile,
  ownsFile,
  publishCurrentGeneration,
  selectProject,
  severityNumber,
  stateAfterAnalysisFailure,
  statusText,
  summaryText,
  zeroBasedLocation,
} from "../../core";

const summary = { pages: 4, reachablePages: 3, unreachablePages: 1, links: 5, groups: 2, errors: 1, warnings: 2 };

test("diagnostic severity and locations preserve analyzer semantics", () => {
  assert.deepEqual([severityNumber("error"), severityNumber("warning"), severityNumber("info")], [0, 1, 2]);
  assert.deepEqual(zeroBasedLocation({ code: "x", severity: "error", message: "x", line: 12, column: 3 }), { line: 11, column: 2 });
  assert.deepEqual(zeroBasedLocation({ code: "x", severity: "error", message: "x", line: 0, column: -4 }), { line: 0, column: 0 });
});

test("summary and status formatting include important counts", () => {
  assert.match(statusText(summary, "Story A"), /4 pages/); assert.match(statusText(summary), /debug-disconnect/);
  assert.equal(summaryText(summary), "4 pages · 3 reachable · 1 unreachable · 5 choices · 2 groups · 1 errors · 2 warnings");
});

test("project ownership and active-file selection work for multi-root projects", () => {
  assert.ok(ownsFile("/workspace/a", "pages", "/workspace/a/pages/1.md"));
  assert.ok(!ownsFile("/workspace/a", "pages", "/workspace/b/pages/1.md"));
  assert.ok(isGeneratedFile("/workspace/a", "/workspace/a/.story-tools/analysis.json"));
  assert.ok(isGeneratedFile("/workspace/a", "/workspace/a/.story-tools/.analysis.1.2.tmp"));
  assert.ok(!ownsFile("/workspace/a", ".story-tools", "/workspace/a/.story-tools/analysis.json"));
  const projects = [{ root: "/workspace/a" }, { root: "/workspace/b" }];
  assert.equal(selectProject(projects, "/workspace/b/pages/1.md"), projects[1]);
  assert.equal(selectProject(projects), undefined);
});

test("a newly requested generation makes a running generation stale", async () => {
  const current: Array<[number, boolean]> = []; let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let scheduler!: GenerationScheduler;
  scheduler = new GenerationScheduler(async generation => {
    if (!current.length) await blocked;
    current.push([generation, scheduler.isCurrent(generation)]);
  }, 5);
  const first = scheduler.runNow();
  scheduler.schedule();
  release();
  await first;
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(current, [[1, false], [2, true]]);
  scheduler.dispose();
});

test("scheduler serializes work and reruns after a burst", async () => {
  const calls: number[] = []; let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const scheduler = new GenerationScheduler(async generation => { calls.push(generation); if (calls.length === 1) await blocked; }, 5);
  const first = scheduler.runNow(); scheduler.schedule(); scheduler.schedule(); release(); await first;
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(calls.length >= 2); assert.ok(calls[1] > calls[0]); scheduler.dispose();
});

test("extension adapter delegates currentness and accepts only the latest shared result", async () => {
  let received: any;
  const sharedResult = {
    analysis: { diagnostics: [] }, publication: {}, serialized: "{}\n", contentHash: "a".repeat(64),
    summary: {}, outputPath: "/workspace/.story-tools/analysis.json", published: true, stale: false,
  };
  const current = await publishCurrentGeneration(async (root, options) => {
    received = { root, generation: options.generation, current: options.isCurrent() };
    return sharedResult;
  }, "/workspace", 7, generation => generation === 7);
  assert.equal(current, sharedResult);
  assert.deepEqual(received, { root: "/workspace", generation: 7, current: true });

  const stale = await publishCurrentGeneration(async (_root, options) => ({
    ...sharedResult,
    published: options.isCurrent(),
    stale: !options.isCurrent(),
  }), "/workspace", 8, () => false);
  assert.equal(stale, undefined);
});

test("shared publication failures preserve prior extension results", () => {
  assert.equal(stateAfterAnalysisFailure(true, "publication-failed"), "idle");
  assert.equal(stateAfterAnalysisFailure(false, "publication-failed"), "error");
  assert.equal(stateAfterAnalysisFailure(true, "analysis-failed"), "error");
});
