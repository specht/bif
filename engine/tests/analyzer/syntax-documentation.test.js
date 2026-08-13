const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '../../..');
const manual = fs.readFileSync(path.join(root, 'SYNTAX.md'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'engine', 'runtime', 'styles.css'), 'utf8');

test('syntax manual has every required reference section', () => {
  for (let section = 1; section <= 11; section += 1) {
    assert.match(manual, new RegExp(`^## ${section}\\.`, 'm'));
  }
});

test('documentation uses the page terminology and does not teach a do attribute', () => {
  assert.doesNotMatch(manual, /\bpassage\b/i);
  assert.doesNotMatch(`${manual}\n${readme}`, /\bdo\s*=\s*["']/i);
  assert.match(readme, /\[SYNTAX\.md\]\(SYNTAX\.md\)/);
  assert.match(readme, /npm run dev/);
  assert.match(readme, /npm run check/);
  const removedTerms = [
    ['force', 'TurnToPage'].join(''),
    ['npm run ', 'analysis'].join(''),
    ['story', '-graph'].join(''),
    ['graph', '.html'].join(''),
  ];
  for (const term of removedTerms) assert.ok(!`${manual}\n${readme}`.includes(term));
});


test('README starter example matches pages-starter/1.md exactly', () => {
  const starter = fs.readFileSync(path.join(root, 'pages-starter', '1.md'), 'utf8').trim();
  const section = readme.match(/The starter deliberately contains only one page:\s*```markdown\n([\s\S]*?)\n```/);
  assert.ok(section, 'README must contain the starter Markdown example');
  assert.equal(section[1].trim(), starter);
});


test('documented story themes exist in the reader stylesheet', () => {
  for (const theme of ['paper', 'mystery', 'midnight', 'terminal', 'playful']) {
    assert.match(styles, new RegExp(`data-story-theme=["']${theme}["']`));
  }
  assert.match(styles, /--story-body-font/);
  assert.match(styles, /--story-heading-font/);
  assert.match(styles, /data-story-brightness=["']dark["']/);
  assert.match(readme, /brightness:\s*(?:light|dark|system)/);
  assert.match(readme, /accent:/);
  assert.match(readme, /background:/);
  assert.match(readme, /text:/);
  assert.match(manual, /accent/);
  assert.match(manual, /background/);
  assert.match(manual, /`text`/);
  assert.match(styles, /--story-accent-color/);
});

test('reader secondary palette is derived from background, text, and accent base colors', () => {
  assert.match(styles, /--bg-color:\s*var\(--story-background\)/);
  assert.match(styles, /--fg-color:\s*var\(--story-text\)/);
  assert.match(styles, /--story-heading-color:\s*var\(--story-text\)/);
  assert.match(styles, /--story-accent-color:\s*var\(--story-accent\)/);
  for (const property of ['surface-1', 'surface-2', 'surface-3', 'border-color', 'border-strong', 'muted-color']) {
    assert.match(styles, new RegExp(`--${property}:\\s*color-mix\\(in oklab, var\\(--story-background\\).*var\\(--story-text\\)`, 's'));
  }
  const terminalLight = styles.match(/html\[data-story-theme="terminal"\][\s\S]*?\n}/)?.[0] || '';
  assert.match(terminalLight, /--story-background:/);
  assert.match(terminalLight, /--story-text:/);
  assert.match(terminalLight, /--story-accent:/);
  assert.doesNotMatch(terminalLight, /--surface-|--border-color|--muted-color/);
});
