const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '../..');
const manual = fs.readFileSync(path.join(root, 'SYNTAX.md'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

test('syntax manual has every required reference section', () => {
  for (let section = 1; section <= 17; section += 1) {
    assert.match(manual, new RegExp(`^## ${section}\\.`, 'm'));
  }
});

test('documentation uses the page terminology and does not teach a do attribute', () => {
  assert.doesNotMatch(manual, /\bpassage\b/i);
  assert.doesNotMatch(`${manual}\n${readme}`, /\bdo\s*=\s*["']/i);
  assert.match(readme, /\[SYNTAX\.md\]\(SYNTAX\.md\)/);
});
