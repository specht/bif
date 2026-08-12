const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { ICONS, generate, output } = require('../../tools/generate-icon-sprite');

test('committed Tabler sprite is deterministic, current, and allowlisted', () => {
  const first = generate();
  assert.equal(first, generate());
  assert.equal(fs.readFileSync(output, 'utf8'), first);
  assert.deepEqual([...first.matchAll(/<symbol id="icon-([^"]+)"/g)].map(match => match[1]), ICONS);
  assert.match(first, /stroke="currentColor"/);
});

test('unknown Tabler icon generation fails clearly', () => {
  assert.throws(() => generate(['not-a-real-icon']), /Unknown Tabler icon/);
});
