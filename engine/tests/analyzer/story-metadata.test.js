const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resolveStoryMetadata, FALLBACK_TITLE, effectiveAppearance, googleFontFamilies } = require('../../runtime/modules/story-metadata');
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

test('story metadata resolves themes and separate body and heading fonts', () => {
  const metadata = resolveStoryMetadata('---\ntheme: mystery\nfont_body: "Atkinson Hyperlegible"\nfont_heading: Special Elite\n---\n# Door\n');
  assert.deepEqual(metadata.appearance, {
    theme: 'mystery',
    brightness: null,
    accent: null,
    background: null,
    text: null,
    fontBody: 'Atkinson Hyperlegible',
    fontHeading: 'Special Elite',
  });
  assert.equal(metadata.effectiveAppearance.fontBody, 'Atkinson Hyperlegible');
  assert.equal(metadata.effectiveAppearance.fontHeading, 'Special Elite');
  assert.deepEqual(googleFontFamilies(metadata.appearance), ['Atkinson Hyperlegible', 'Special Elite']);
  assert.equal(metadata.issues.length, 0);
});

test('themes provide brightness defaults and story metadata can override them', () => {
  assert.equal(effectiveAppearance({ theme: 'default' }).brightness, 'system');
  assert.equal(effectiveAppearance({ theme: 'paper' }).brightness, 'light');
  assert.equal(effectiveAppearance({ theme: 'terminal' }).brightness, 'dark');

  const override = resolveStoryMetadata(`---
theme: terminal
brightness: light
---
# Story
`);
  assert.equal(override.appearance.brightness, 'light');
  assert.equal(override.effectiveAppearance.brightness, 'light');

  const invalid = resolveStoryMetadata(`---
theme: terminal
brightness: sepia
---
# Story
`);
  assert.equal(invalid.appearance.brightness, null);
  assert.equal(invalid.effectiveAppearance.brightness, 'dark');
  assert.ok(invalid.issues.some(item => item.code === 'unknown-brightness'));
});

test('themes provide font pairs and invalid themes fall back safely', () => {
  const paper = effectiveAppearance({ theme: 'paper' });
  assert.equal(paper.fontBody, 'Literata');
  assert.equal(paper.fontHeading, 'DM Serif Display');
  const invalid = resolveStoryMetadata('---\ntheme: definitely-not-a-theme\n---\n# Story\n');
  assert.equal(invalid.appearance.theme, 'default');
  assert.ok(invalid.issues.some(item => item.code === 'unknown-theme'));
});

test('story metadata accepts accent, background, and text colors and rejects malformed values', () => {
  const valid = resolveStoryMetadata('---\naccent: "#D91E36"\nbackground: "#18141A"\ntext: "#FFB347"\n---\n# Door\n');
  assert.equal(valid.appearance.accent, '#d91e36');
  assert.equal(valid.appearance.background, '#18141a');
  assert.equal(valid.appearance.text, '#ffb347');
  assert.equal(valid.effectiveAppearance.accent, '#d91e36');
  assert.equal(valid.effectiveAppearance.background, '#18141a');
  assert.equal(valid.effectiveAppearance.text, '#ffb347');
  assert.equal(valid.issues.length, 0);

  const invalid = resolveStoryMetadata('---\naccent: tomato\nbackground: "#12345"\ntext: green\n---\n# Door\n');
  assert.equal(invalid.appearance.accent, null);
  assert.equal(invalid.appearance.background, null);
  assert.equal(invalid.appearance.text, null);
  assert.equal(invalid.issues.filter(item => item.code === 'invalid-color').length, 3);
});

test('story metadata warns about low contrast without changing custom colors', () => {
  const metadata = resolveStoryMetadata('---\nbackground: "#777777"\ntext: "#888888"\n---\n# Door\n');
  assert.equal(metadata.appearance.background, '#777777');
  assert.equal(metadata.appearance.text, '#888888');
  assert.ok(metadata.issues.some(item => item.code === 'low-color-contrast'));
});
