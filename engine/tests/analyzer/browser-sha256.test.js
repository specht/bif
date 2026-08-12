const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

async function loadSha256() {
  return import(pathToFileURL(path.join(process.cwd(), 'engine/dev/browser-sha256.js')));
}

test('browser SHA-256 matches standard vectors without Web Crypto', async () => {
  const { sha256Hex } = await loadSha256();
  const encoder = new TextEncoder();
  const vectors = new Map([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
  ]);
  for (const [input, expected] of vectors) assert.equal(sha256Hex(encoder.encode(input)), expected);
});

test('browser SHA-256 matches Node for different input lengths', async () => {
  const { sha256Hex } = await loadSha256();
  for (const length of [1, 7, 55, 56, 57, 63, 64, 65, 255, 1024, 4097]) {
    const bytes = Buffer.alloc(length);
    for (let index = 0; index < length; index += 1) bytes[index] = (index * 31 + length) & 0xff;
    const expected = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha256Hex(bytes), expected, `length ${length}`);
  }
});

test('analysis manifest verification works without global Web Crypto', async () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    const { createBrowserAnalysisClient } = await import(pathToFileURL(path.join(process.cwd(), 'engine/dev/browser-analysis-client.js')));
    const configBytes = new TextEncoder().encode("export const path = './pages';\n");
    const configHash = crypto.createHash('sha256').update(configBytes).digest('hex');
    const model = {
      schemaVersion: 2,
      contentHash: 'content',
      analysisHash: 'a'.repeat(64),
      inputManifest: [{ path: 'config.js', sha256: configHash }],
      project: { title: 'HTTP authoring', pagesPath: 'pages', startPage: '1' },
      summary: Object.fromEntries([
        'pages', 'reachablePages', 'unreachablePages', 'choices', 'groups',
        'missingTargets', 'errors', 'warnings',
      ].map(key => [key, 0])),
      nodes: [],
      edges: [],
      groups: [],
      diagnostics: [],
    };
    const documentObject = {
      baseURI: 'http://example.test:8080/',
      hidden: false,
      addEventListener() {},
      removeEventListener() {},
    };
    const windowObject = {
      location: { href: documentObject.baseURI },
      addEventListener() {},
      removeEventListener() {},
    };
    const fetchImplementation = async url => {
      const href = String(url);
      if (href.includes('analysis.json')) return new Response(JSON.stringify(model));
      if (href.includes('config.js')) return new Response(configBytes);
      return new Response('', { status: 404 });
    };
    const client = createBrowserAnalysisClient({
      fetchImplementation,
      documentObject,
      windowObject,
      setTimeoutImplementation: () => 1,
      clearTimeoutImplementation() {},
    });
    await client.start();
    assert.equal(client.getState().status, 'ready');
    assert.equal(client.getState().model.project.title, 'HTTP authoring');
    client.dispose();
  } finally {
    if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
    else delete globalThis.crypto;
  }
});
