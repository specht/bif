const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { analyzeStory } = require('../../tools/lib/story-analyzer');
const { buildAuthoringGraph } = require('../../tools/lib/authoring-graph-model');

const fixture = path.resolve(__dirname, '../../test-fixtures/authoring-graph/complete-project');

test('browser graph model retains pages, groups, diagnostics, and stable identities', async () => {
  const analysis = await analyzeStory(fixture);
  const first = buildAuthoringGraph(analysis);
  const second = buildAuthoringGraph(await analyzeStory(fixture));
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.nodes.filter(node => node.kind === 'page').length, 3);
  assert.ok(first.nodes.some(node => node.kind === 'missing' && node.pageId === '99'));
  assert.deepEqual(first.groups.map(group => group.name), ['Harbor', 'Mountain', 'Missing targets']);
  assert.equal(first.summary.errors, 2);
  const parallel = first.edges.filter(edge => edge.source === '1' && edge.target === '2');
  assert.equal(parallel.length, 2);
  assert.notEqual(parallel[0].edgeId, parallel[1].edgeId);
});
