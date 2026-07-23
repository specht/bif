const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { parsePage } = require('../../tools/lib/page-parser');
const { analyzeStory } = require('../../tools/lib/story-analyzer');
const { buildBrowserAnalysisPublication } = require('../../tools/lib/browser-analysis-publication');
const { classifyChoiceTarget } = require('../../runtime/modules/choice-result-model');

test('only the exact dot target classifies as local', () => {
  assert.deepEqual(classifyChoiceTarget('.'), { kind: 'local', target: null, rawTarget: '.' });
  assert.deepEqual(classifyChoiceTarget('./'), { kind: 'page', target: './', rawTarget: './' });
  assert.deepEqual(classifyChoiceTarget(''), { kind: 'page', target: '', rawTarget: '' });
});

test('choice result blocks are structural, source mapped, and uniquely identified', () => {
  const source = `- [Same](.)\n\n    > Answer\n\n- [Same](.)\n\n    - ordinary nested item\n\n- [Go](2)\n\n    <script>\n    ready = true;\n    </script>`;
  const page = parsePage(source, { pageId: '7' });
  assert.equal(page.choices.length, 3);
  assert.equal(page.choices.filter(choice => choice.local).length, 2);
  assert.deepEqual(
    { kind: page.choices[0].kind, target: page.choices[0].target, rawTarget: page.choices[0].rawTarget },
    { kind: 'local', target: null, rawTarget: '.' },
  );
  assert.equal(new Set(page.choices.map(choice => choice.choiceId)).size, 3);
  assert.equal(page.resultBlocks[0].resultMarkdown, '> Answer');
  assert.equal(page.resultBlocks[1].nestedChoices.length, 0);
  assert.equal(page.resultScripts[0].choiceId, page.choices[2].choiceId);
  assert.equal(page.resultScripts[0].result, true);
  assert.ok(page.resultScripts[0].line > page.choices[2].line);
});

test('analyzer excludes local choices from graph edges and validates result content', async () => {
  const root = path.resolve(__dirname, '../../test-fixtures/choice-results');
  const result = await analyzeStory(root);
  assert.equal(result.summary.localChoices, 3);
  assert.equal(result.summary.resultBlocks, 5);
  assert.equal(result.summary.resultScripts, 3);
  assert.equal(result.graph.edges.some(edge => edge.target === '.'), false);
  assert.deepEqual(result.graph.edges.map(edge => edge.target), ['2', '3', '4', '4']);
  assert.equal(result.graph.edges.filter(edge => edge.source === '1' && edge.target === '4').length, 2);
  assert.equal(result.diagnostics.some(item => item.code === 'missing-page' && item.target === '.'), false);
  assert.equal(result.diagnostics.filter(item => item.severity === 'error').length, 0);
  const publication = buildBrowserAnalysisPublication(result);
  const localChoices = publication.nodes.flatMap(node => node.choices || []).filter(choice => choice.kind === 'local');
  assert.equal(localChoices.length, 3);
  assert.ok(localChoices.every(choice => choice.target === null && choice.rawTarget === '.'));
  assert.equal(publication.edges.some(edge => edge.target === '.'), false);
});

test('nested story choices in a result and empty local choices are diagnosed', async () => {
  const nested = parsePage('- [Ask](.)\n\n    - [Nested](2)', { pageId: '1' });
  assert.deepEqual(nested.resultBlocks[0].nestedChoices, ['2']);
});
