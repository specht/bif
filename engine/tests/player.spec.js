import { expect, test } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

const repository = process.cwd();

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html';
  if (file.endsWith('.js')) return 'text/javascript';
  if (file.endsWith('.css')) return 'text/css';
  if (file.endsWith('.md')) return 'text/markdown';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

async function useFixture(page, storyPath) {
  await page.route(/\/config\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: `export const path = '${storyPath}';` }));
}

test('game mode plays without analysis or authoring modules', async ({ page }) => {
  await useFixture(page, 'engine/test-fixtures/player-basic/pages');
  const devRequests = [];
  page.on('request', request => { if (request.url().includes('/engine/dev/')) devRequests.push(request.url()); });
  await page.goto('/?mode=game');
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
  await page.getByRole('link', { name: 'Take the direct route.' }).click();
  await expect(page.getByRole('heading', { name: 'Destination' })).toBeVisible();
  expect(devRequests).toEqual([]);
});

test('straight quotes in story prose render as German typographic quotes', async ({ page }) => {
  await useFixture(page, 'engine/test-fixtures/player-basic/pages');
  await page.route(/\/engine\/test-fixtures\/player-basic\/pages\/1\.md(?:\?.*)?$/, route => route.fulfill({
    contentType: 'text/markdown',
    body: '# Start\n\n> "Der ist abgeschlossen."\n',
  }));
  await page.goto('/?mode=game');
  await expect(page.locator('blockquote')).toHaveText('„Der ist abgeschlossen.“');
});

test('session hash contains only the current versioned JSON schema', async ({ page }) => {
  await useFixture(page, 'engine/test-fixtures/player-basic/pages');
  await page.goto('/?mode=game');
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
  const decoded = await page.evaluate(() => JSON.parse(LZString.decompressFromEncodedURIComponent(location.hash.slice(1))));
  expect(decoded.version).toBe(1);
  expect(Array.isArray(decoded.events)).toBe(true);
});

test('malformed and unsupported hashes safely begin a new session', async ({ page }) => {
  await useFixture(page, 'engine/test-fixtures/player-basic/pages');
  await page.goto('/?mode=game#not-a-session');
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
  await page.goto(`/?mode=game#${await page.evaluate(() => LZString.compressToEncodedURIComponent(JSON.stringify({ version: 99, seed: 1, events: [] })))}`);
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
});

test('story-local image resolves from the configured story folder', async ({ page }) => {
  await useFixture(page, 'engine/test-fixtures/analyzer/valid/pages');
  await page.goto('/?mode=game');
  await expect(page.locator('img').first()).toHaveAttribute('src', /\/engine\/test-fixtures\/analyzer\/valid\/pages\/assets\/present\.png$/);
});

test('the exact minimum upload plays below a nested static path', async ({ page }) => {
  const deployment = await mkdtemp(path.join(os.tmpdir(), 'bif-minimum-'));
  try {
    await cp(path.join(repository, 'index.html'), path.join(deployment, 'index.html'));
    await mkdir(path.join(deployment, 'engine'), { recursive: true });
    await cp(path.join(repository, 'engine/runtime'), path.join(deployment, 'engine/runtime'), { recursive: true });
    await cp(path.join(repository, 'engine/test-fixtures/player-basic/pages'), path.join(deployment, 'pages-test'), { recursive: true });
    await writeFile(path.join(deployment, 'config.js'), 'export const path = "pages-test";\n');
    const requests = [];
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    await page.route('**/students/alex/story/**', async route => {
      const url = new URL(route.request().url());
      const relative = url.pathname.replace(/^\/students\/alex\/story\/?/, '') || 'index.html';
      try {
        await route.fulfill({ body: await readFile(path.join(deployment, relative)), contentType: contentType(relative) });
      } catch {
        await route.fulfill({ status: 404 });
      }
    });
    await page.goto('/students/alex/story/?mode=game');
    await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
    expect(requests.filter(url => url.includes('/engine/runtime/') || url.includes('/pages-test/'))
      .every(url => url.startsWith('/students/alex/story/')), JSON.stringify(requests, null, 2)).toBe(true);
    expect(requests.some(url => url.includes('/engine/dev/'))).toBe(false);
  } finally {
    await rm(deployment, { recursive: true });
  }
});

test('story front matter applies a theme and separate bundled body and heading fonts', async ({ page }) => {
  await useFixture(page, 'engine/test-fixtures/player-basic/pages');
  await page.route(/\/engine\/test-fixtures\/player-basic\/pages\/1\.md(?:\?.*)?$/, route => route.fulfill({
    contentType: 'text/markdown',
    body: '---\ntheme: paper\nfont_body: IBM Plex Mono\nfont_heading: IBM Plex Sans\n---\n# Start\n\nStyled story.\n',
  }));
  await page.goto('/?mode=game');
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-story-theme', 'paper');
  const fonts = await page.evaluate(() => ({
    body: getComputedStyle(document.getElementById('game_pane')).fontFamily,
    heading: getComputedStyle(document.querySelector('#game_pane h1')).fontFamily,
  }));
  expect(fonts.body).toContain('IBM Plex Mono');
  expect(fonts.heading).toContain('IBM Plex Sans');
});

test('Google font metadata makes the reader request only the story-local generated stylesheet', async ({ page }) => {
  await useFixture(page, 'engine/test-fixtures/player-basic/pages');
  await page.route(/\/engine\/test-fixtures\/player-basic\/pages\/1\.md(?:\?.*)?$/, route => route.fulfill({
    contentType: 'text/markdown',
    body: '---\nfont_body: Literata\nfont_heading: IBM Plex Sans\n---\n# Start\n\nLocal font story.\n',
  }));
  await page.route(/\/engine\/test-fixtures\/player-basic\/pages\/bif-assets\/fonts\.css(?:\?.*)?$/, route => route.fulfill({
    contentType: 'text/css',
    body: '@font-face { font-family: "Literata"; src: local("Arial"); }',
  }));
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/?mode=game');
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
  await expect.poll(() => requests.some(url => url.includes('/pages/bif-assets/fonts.css'))).toBe(true);
  expect(requests.some(url => url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com'))).toBe(false);
});
