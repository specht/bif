import * as assert from "node:assert/strict";
import test from "node:test";
import * as path from "node:path";
import { findSourceMatches, parseSourceRequest, SOURCE_URI_AUTHORITY, SOURCE_URI_PATH } from "../../source-uri-core";

const request = (query: string, authority = SOURCE_URI_AUTHORITY, path = SOURCE_URI_PATH) => parseSourceRequest({ authority, path, query });

test("valid source requests preserve one-based relative locations", () => {
  assert.deepEqual(request("file=pages%2F1.md&line=12&column=21"), { file: "pages/1.md", line: 12, column: 21 });
});

test("source requests reject traversal and absolute paths", () => {
  for (const file of ["../secret", "%252e%252e%252fsecret", "/etc/passwd", "C%3A%5Csecret", "%5C%5Cserver%5Cshare", "https%3A%2F%2Fexample.com"]) {
    assert.equal(request(`file=${file}&line=1&column=1`), undefined, file);
  }
});

test("source requests reject malformed actions and positions", () => {
  assert.equal(request("file=pages%2F1.md&line=1&column=1", "wrong.extension"), undefined);
  assert.equal(request("file=pages%2F1.md&line=1&column=1", SOURCE_URI_AUTHORITY, "/wrong"), undefined);
  for (const query of ["", "file=pages%2F1.md", "file=pages%2F1.md&line=0&column=1", "file=pages%2F1.md&line=-1&column=1", "file=pages%2F1.md&line=no&column=1", "file=pages%2F1.md&line=1000001&column=1"]) assert.equal(request(query), undefined, query);
});

test("source matching is confined to known project roots and supports multi-root workspaces", async () => {
  const projects = [{ name: "first", root: "/workspace/first" }, { name: "second", root: "/workspace/second" }];
  const existing = new Set([path.resolve("/workspace/first/pages/1.md"), path.resolve("/workspace/second/pages/1.md")]);
  const matches = await findSourceMatches(
    { file: "pages/1.md", line: 1, column: 1 },
    projects,
    async file => existing.has(file),
  );
  assert.deepEqual(matches.map(match => [match.label, match.description, match.file]), [
    ["first", "pages/1.md", path.resolve("/workspace/first/pages/1.md")],
    ["second", "pages/1.md", path.resolve("/workspace/second/pages/1.md")],
  ]);
  assert.deepEqual(await findSourceMatches({ file: "pages/missing.md", line: 1, column: 1 }, projects, async () => false), []);
});
