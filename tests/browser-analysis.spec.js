import { expect, test } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import storyAnalyzer from '../tools/lib/story-analyzer.js';
import publicationTools from '../tools/lib/browser-analysis-publication.js';

const { analyzeStory } = storyAnalyzer;
const { buildBrowserAnalysisPublication } = publicationTools;
const root = process.cwd();

async function publicationFor(project) {
  return buildBrowserAnalysisPublication(await analyzeStory(path.join(root, project)));
}

async function configureFixture(page, project, storyFolder = 'pages') {
  const publication = await publicationFor(project);
  const config = `export const path = ${JSON.stringify(`${project}/${storyFolder}`)};\n`;
  const configHash = createHash('sha256').update(config).digest('hex');
  publication.inputManifest = publication.inputManifest.map(entry => ({
    ...entry,
    path: entry.path === 'config.js' ? 'config.js' : `${project}/${entry.path}`,
    sha256: entry.path === 'config.js' ? configHash : entry.sha256,
  }));
  await page.route(/\/config\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: config }));
  await page.route(/\/\.story-tools\/analysis\.json(?:\?.*)?$/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(publication) }));
  return { publication, config };
}

test('current analysis renders the authoritative graph', async ({ page }) => {
  await configureFixture(page, 'test-fixtures/authoring-graph/complete-project');
  await page.goto('/?mode=dev');
  await expect(page.locator('#graph-container')).toHaveAttribute('data-graph-source', 'analysis');
  await expect(page.locator('#node_1')).toBeVisible();
  await expect(page.locator('#project-analysis-status')).toBeHidden();
});

test('missing analysis is actionable and retry recovers', async ({ page }) => {
  const { publication } = await configureFixture(page, 'test-fixtures/authoring-graph/complete-project');
  let missing = true;
  await page.unroute(/\/\.story-tools\/analysis\.json(?:\?.*)?$/);
  await page.route(/\/\.story-tools\/analysis\.json(?:\?.*)?$/, route => missing
    ? route.fulfill({ status: 404 })
    : route.fulfill({ contentType: 'application/json', body: JSON.stringify(publication) }));
  await page.goto('/?mode=dev');
  await expect(page.locator('#project-analysis-status')).toContainText('Authoring analysis is unavailable');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  missing = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('#node_1')).toBeVisible();
});

test('invalid analysis is reported as unavailable without a graph', async ({ page }) => {
  await page.route(/\/config\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: "export const path = 'pages';" }));
  await page.route(/\/\.story-tools\/analysis\.json(?:\?.*)?$/, route => route.fulfill({ contentType: 'application/json', body: '{"schemaVersion":2}' }));
  await page.goto('/?mode=dev');
  await expect(page.locator('#project-analysis-status')).toContainText('Authoring analysis is invalid');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.locator('#graph-container')).not.toHaveAttribute('data-graph-source', 'analysis');
});

test('changed input marks the retained graph stale and recovery clears it', async ({ page }) => {
  const { publication, config } = await configureFixture(page, 'test-fixtures/authoring-graph/complete-project');
  let changed = false;
  await page.unroute(/\/config\.js(?:\?.*)?$/);
  await page.route(/\/config\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: changed ? `${config}\n// edited` : config }));
  await page.goto('/?mode=dev');
  await expect(page.locator('#node_1')).toBeVisible();
  changed = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#project-analysis-status')).toContainText('Authoring analysis is out of date');
  await expect(page.locator('#node_1')).toBeVisible();
  changed = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('#project-analysis-status')).toBeHidden();
  expect(publication.schemaVersion).toBe(2);
});

test('strict schema rejects unsupported and malformed publications safely', async ({ page }) => {
  await page.goto('/?mode=game');
  const results = await page.evaluate(async () => {
    const { validateBrowserAnalysis } = await import('/dev/browser-analysis-client.js');
    return [validateBrowserAnalysis({ schemaVersion: 1 }), validateBrowserAnalysis(null)].map(item => item.valid);
  });
  expect(results).toEqual([false, false]);
});

test('local mode preference is path-scoped and production ignores dev override', async ({ page }) => {
  await page.goto('/?mode=game');
  const result = await page.evaluate(async () => {
    const mode = await import('/runtime/modules/browser-mode.js');
    const values = new Map();
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    const localA = { origin: 'http://localhost:4173', pathname: '/a/', port: '4173', search: '', href: 'http://localhost:4173/a/' };
    const localB = { ...localA, pathname: '/b/', href: 'http://localhost:4173/b/' };
    const production = { origin: 'https://example.org', pathname: '/story/', port: '', search: '?mode=dev', href: 'https://example.org/story/?mode=dev' };
    const first = mode.resolveBrowserMode(localA, storage);
    mode.rememberBrowserMode('game', localA, storage);
    return { first, remembered: mode.resolveBrowserMode(localA, storage), isolated: mode.resolveBrowserMode(localB, storage), production: mode.resolveBrowserMode(production, storage) };
  });
  expect(result).toEqual({ first: 'dev', remembered: 'game', isolated: 'dev', production: 'game' });
});

test('explicit local controls remember both views and preserve the session hash', async ({ page }) => {
  await page.goto('/?mode=game#session');
  await expect.poll(() => new URL(page.url()).hash).not.toBe('#session');
  const sessionHash = new URL(page.url()).hash;
  await expect(page.getByRole('button', { name: 'Open authoring view' })).toBeVisible();
  await page.getByRole('button', { name: 'Open authoring view' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('mode')).toBe('dev');
  expect(new URL(page.url()).hash).toBe(sessionHash);
  await expect(page.getByRole('button', { name: 'Open game view' })).toBeVisible();
});

test('production mode does not request authoring modules', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://example.test' });
  const page = await context.newPage();
  const devRequests = [];
  page.on('request', request => { if (request.url().includes('/dev/')) devRequests.push(request.url()); });
  await page.route('http://example.test/**', async route => {
    const url = new URL(route.request().url());
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    try { await route.fulfill({ body: await readFile(path.join(root, relative)), contentType: relative.endsWith('.js') ? 'text/javascript' : undefined }); }
    catch { await route.fulfill({ status: 404 }); }
  });
  await page.goto('/?mode=dev');
  await expect(page.locator('#content')).toBeVisible();
  await expect(page.locator('#bif-view-switch')).toHaveCount(0);
  expect(devRequests).toEqual([]);
  await context.close();
});
