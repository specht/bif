const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resolveStoryMetadata, FALLBACK_TITLE } = require('../../runtime/modules/story-metadata');
const { analyzeStory } = require('../../tools/lib/story-analyzer');

test('story metadata resolves front matter, quoted values, H1 precedence, and stripped body', () => {
  const front = resolveStoryMetadata('\uFEFF---\r\ntitle: "City: Thieves"\r\n---\r\n# Visible heading\r\n');
  assert.equal(front.title, 'City: Thieves');
  assert.equal(front.titleSource, 'front-matter');
  assert.equal(front.bodyMarkdown, '\n\n\n# Visible heading\n');
  assert.match(front.bodyMarkdown, /Visible heading/);
  assert.equal(resolveStoryMetadata("---\ntitle: 'Quoted title'\n---\nBody").title, 'Quoted title');
  assert.equal(resolveStoryMetadata('# Heading title').title, 'Heading title');
});

test('story metadata ignores code fences and image alt text and falls back once', () => {
  const missing = resolveStoryMetadata('```js\n# not a title\n```\n![Artwork title](title.jpg)');
  assert.equal(missing.title, FALLBACK_TITLE);
  assert.equal(missing.warnings.length, 1);
  const malformed = resolveStoryMetadata('---\ntitle: broken\n# Safe fallback');
  assert.equal(malformed.title, 'Safe fallback');
  assert.equal(malformed.warnings.length, 1);
});

test('hostile title metadata remains inert data', () => {
  const result = resolveStoryMetadata('---\ntitle: "</script><img src=x onerror=boom>"\n---\nText');
  assert.equal(result.title, '</script><img src=x onerror=boom>');
});

test('stripped front matter preserves source line positions for diagnostics', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bif-title-lines-'));
  await fs.mkdir(path.join(root, 'pages'));
  await fs.writeFile(path.join(root, 'config.js'), "export const path = 'pages';\n");
  await fs.writeFile(path.join(root, 'pages', '1.md'), '---\ntitle: Lines\n---\n\n<script>\nbroken !!!!;\n</script>\n');
  const result = await analyzeStory(root);
  assert.equal(result.diagnostics.find(item => item.code === 'script-syntax').line, 6);
});

test('config path selects the directory and title comes from page 1', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bif-title-'));
  await fs.mkdir(path.join(root, 'chosen'));
  await fs.writeFile(path.join(root, 'config.js'), "export const path = 'chosen';\n");
  await fs.writeFile(path.join(root, 'chosen', '1.md'), '# Derived title\n');
  const result = await analyzeStory(root);
  assert.equal(result.project.title, 'Derived title');
  assert.equal(result.project.startPage, '1');
  assert.equal(result.project.pagesPath, 'chosen');
  assert.equal(result.diagnostics.some(item => item.code === 'missing-story-title'), false);
});
