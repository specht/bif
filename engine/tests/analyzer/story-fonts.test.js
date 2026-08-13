const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { syncStoryFonts, requestUrl, fontUrls } = require('../../tools/lib/story-fonts');

function response(body, options = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  return {
    ok: options.status ? options.status >= 200 && options.status < 300 : true,
    status: options.status || 200,
    async text() { return bytes.toString('utf8'); },
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
}

test('Google Fonts request encodes a family name without exposing CSS details to authors', () => {
  const url = new URL(requestUrl('DM Serif Display'));
  assert.equal(url.origin, 'https://fonts.googleapis.com');
  assert.equal(url.searchParams.get('family'), 'DM Serif Display');
  assert.equal(url.searchParams.get('display'), 'swap');
  assert.deepEqual(fontUrls("src:url('https://fonts.gstatic.com/a.woff2'); src: url(https://fonts.gstatic.com/b.woff2)"), [
    'https://fonts.gstatic.com/a.woff2',
    'https://fonts.gstatic.com/b.woff2',
  ]);
});

test('font synchronization stores CSS, font data and license inside the story and then uses the cache', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bif-fonts-'));
  const story = path.join(root, 'pages');
  await fs.mkdir(story);
  const calls = [];
  const fakeFetch = async url => {
    const value = String(url);
    calls.push(value);
    if (value.startsWith('https://fonts.googleapis.com/css2')) {
      return response("@font-face { font-family: 'Literata'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/literata/test.woff2) format('woff2'); }");
    }
    if (value === 'https://fonts.gstatic.com/s/literata/test.woff2') return response(Buffer.from([1, 2, 3, 4]));
    if (value.endsWith('/ofl/literata/OFL.txt')) return response('Copyright Example\nSIL OPEN FONT LICENSE');
    return response('not found', { status: 404 });
  };

  const project = { pagesPath: 'pages', appearance: { theme: 'default', fontBody: 'Literata', fontHeading: 'Literata' } };
  const first = await syncStoryFonts(root, project, { fetchImpl: fakeFetch });
  assert.deepEqual(first.errors, []);
  assert.equal(first.downloaded, true);
  assert.deepEqual(first.families, ['Literata']);

  const generated = path.join(story, 'bif-assets');
  const css = await fs.readFile(path.join(generated, 'fonts.css'), 'utf8');
  assert.match(css, /font-family: 'Literata'/);
  assert.match(css, /url\(fonts\/literata-01\.woff2\)/);
  assert.doesNotMatch(css, /fonts\.gstatic\.com/);
  assert.deepEqual([...await fs.readFile(path.join(generated, 'fonts', 'literata-01.woff2'))], [1, 2, 3, 4]);
  assert.match(await fs.readFile(path.join(generated, 'fonts', 'literata-OFL.txt'), 'utf8'), /OPEN FONT LICENSE/);

  const second = await syncStoryFonts(root, project, { fetchImpl: async () => { throw new Error('cache miss'); } });
  assert.equal(second.cached, true);
  assert.equal(second.downloaded, false);
  assert.ok(calls.some(url => url.startsWith('https://fonts.googleapis.com/css2')));
});

test('bundled font pairs need no generated story font directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bif-fonts-bundled-'));
  const story = path.join(root, 'pages');
  await fs.mkdir(path.join(story, 'bif-assets'), { recursive: true });
  await fs.writeFile(path.join(story, 'bif-assets', 'stale.txt'), 'stale');
  const result = await syncStoryFonts(root, {
    pagesPath: 'pages',
    appearance: { theme: 'terminal', fontBody: null, fontHeading: null },
  }, { fetchImpl: async () => { throw new Error('network should not be used'); } });
  assert.deepEqual(result.families, []);
  await assert.rejects(fs.access(path.join(story, 'bif-assets')));
});
