import { expect, test } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';

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
  await useFixture(page, 'test-fixtures/player-basic/pages');
  const devRequests = [];
  page.on('request', request => { if (request.url().includes('/dev/')) devRequests.push(request.url()); });
  await page.goto('/?mode=game');
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
  await page.getByRole('link', { name: 'Take the direct route.' }).click();
  await expect(page.getByRole('heading', { name: 'Destination' })).toBeVisible();
  expect(devRequests).toEqual([]);
});

test('session hash contains only the current versioned JSON schema', async ({ page }) => {
  await useFixture(page, 'test-fixtures/player-basic/pages');
  await page.goto('/?mode=game');
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
  const decoded = await page.evaluate(() => JSON.parse(LZString.decompressFromEncodedURIComponent(location.hash.slice(1))));
  expect(decoded.version).toBe(1);
  expect(Array.isArray(decoded.events)).toBe(true);
});

test('malformed and unsupported hashes safely begin a new session', async ({ page }) => {
  await useFixture(page, 'test-fixtures/player-basic/pages');
  await page.goto('/?mode=game#not-a-session');
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
  await page.goto(`/?mode=game#${await page.evaluate(() => LZString.compressToEncodedURIComponent(JSON.stringify({ version: 99, seed: 1, events: [] })))}`);
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
});

test('story-local image resolves from the configured story folder', async ({ page }) => {
  await useFixture(page, 'pages');
  await page.goto('/?mode=game');
  await expect(page.locator('img').first()).toHaveAttribute('src', /\/pages\/images\/odysseus\.jpg$/);
});

test('the exact minimum upload plays below a nested static path', async ({ page }) => {
  const deployment = await mkdtemp(path.join(os.tmpdir(), 'bif-minimum-'));
  try {
    for (const entry of ['index.html', 'config.js', 'runtime', 'pages']) {
      await cp(path.join(repository, entry), path.join(deployment, entry), { recursive: true });
    }
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
    await expect(page.locator('.story-passage').first()).toBeVisible();
    expect(requests.filter(url => url.includes('/runtime/') || url.includes('/pages/'))
      .every(url => url.startsWith('/students/alex/story/')), JSON.stringify(requests, null, 2)).toBe(true);
    expect(requests.some(url => url.includes('/dev/'))).toBe(false);
  } finally {
    await rm(deployment, { recursive: true });
  }
});
