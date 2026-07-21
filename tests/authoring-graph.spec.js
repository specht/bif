import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const repository = process.cwd();
const output = path.join(repository, '.story-tools', 'authoring-test.html');
const escapingOutput = path.join(repository, '.story-tools', 'authoring-escaping-test.html');

test.beforeAll(() => {
  for (const [project, target] of [
    ['test-fixtures/authoring-graph/complete-project', output],
    ['test-fixtures/authoring-graph/escaping', escapingOutput],
  ]) {
    const result = spawnSync(process.execPath, ['tools/story-graph.js', '--project', path.join(repository, project), '--output', target], { cwd: repository, encoding: 'utf8' });
    if (![0, 1].includes(result.status)) throw new Error(result.stderr || result.stdout);
  }
});

async function openGraph(page) {
  const pageErrors = [];
  const externalRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(request.url());
  });
  await page.goto('/.story-tools/authoring-test.html');
  await expect(page.locator('#canvas svg')).toBeVisible();
  return { pageErrors, externalRequests };
}

test('standalone authoring graph renders every real and missing node offline', async ({ page }) => {
  const captured = await openGraph(page);
  await expect(page.getByRole('heading', { name: /Complete graph fixture/ })).toBeVisible();
  await expect(page.locator('.authoring-node.page')).toHaveCount(3);
  await expect(page.locator('.authoring-node.unreachable')).toHaveCount(2);
  await expect(page.locator('.authoring-node.missing')).toHaveCount(1);
  expect(captured.pageErrors).toEqual([]);
  expect(captured.externalRequests).toEqual([]);
});

test('page selection shows source, reachability, choices, and diagnostics', async ({ page }) => {
  await openGraph(page);
  await page.locator('[id="node-page-31"]').click();
  await expect(page.locator('[id="node-page-31"]')).toHaveClass(/selected/);
  await expect(page.locator('#details')).toContainText('Page 1');
  await expect(page.locator('#details')).toContainText('pages/1.md');
  await expect(page.locator('#details')).toContainText('Reachable');
  await expect(page.locator('#details')).toContainText('Take the guarded road');
  await expect(page.locator('#details')).toContainText('expression-syntax');
  await expect(page.getByRole('link', { name: 'Open in VS Code' })).toBeVisible();
});

test('parallel edge selection retains the correct choice metadata', async ({ page }) => {
  await openGraph(page);
  const edgeId = await page.locator('#graph-data').evaluate(element => JSON.parse(element.textContent).edges.find(edge => edge.label === 'Guarded road').edgeId);
  await page.locator(`[id="${edgeId}"] .edge-hit`).dispatchEvent('click');
  await expect(page.locator('#details')).toContainText('Take the guarded road');
  await expect(page.locator('#details')).toContainText('Guarded road');
  await expect(page.locator('#details')).toContainText('has_key');
  await expect(page.locator('.authoring-edge')).toHaveCount(3);
});

test('missing target details list its expected file and broken reference', async ({ page }) => {
  await openGraph(page);
  await page.locator('.authoring-node.missing').click();
  await expect(page.locator('#details')).toContainText('Missing: 99');
  await expect(page.locator('#details')).toContainText('pages/99.md');
  await expect(page.locator('#details')).toContainText('Search for the vanished tower');
  await expect(page.locator('#details')).toContainText('missing-page');
});

test('search finds page, label, diagnostic, and choice text and supports Enter and Escape', async ({ page }) => {
  await openGraph(page);
  const search = page.locator('#search');
  for (const query of ['3', 'High pass', 'unreachable', 'bright road']) {
    await search.fill(query);
    await expect(page.locator('#match-count')).not.toHaveText('0 matches');
    await expect(page.locator('.search-match').first()).toBeVisible();
  }
  await search.press('Enter');
  await expect(page.locator('.selected')).toHaveCount(1);
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(page.locator('.search-match')).toHaveCount(0);
});

test('status and group filters isolate nodes and can restore the full graph', async ({ page }) => {
  await openGraph(page);
  await page.locator('#status-filter').selectOption('unreachable');
  await expect(page.locator('.authoring-node.page:not(.filtered)')).toHaveCount(1);
  await page.locator('#status-filter').selectOption('errors');
  await expect(page.locator('.authoring-node:not(.filtered)')).toHaveCount(2);
  await page.locator('#status-filter').selectOption('all');
  await page.locator('#group-filter').selectOption('Mountain');
  await expect(page.locator('.authoring-node.page:not(.filtered)')).toHaveCount(2);
  await page.locator('#group-filter').selectOption('all');
  await expect(page.locator('.authoring-node:not(.filtered)')).toHaveCount(4);
});

test('zoom, fit, reset, and source-link contracts work', async ({ page }) => {
  await openGraph(page);
  const canvas = page.locator('#canvas');
  const initial = await canvas.getAttribute('data-view-state');
  await page.locator('#zoom-in').click();
  await expect(canvas).not.toHaveAttribute('data-view-state', initial);
  await page.locator('#fit').click();
  await page.locator('#reset').click();
  await expect(canvas).toHaveAttribute('data-view-state', '1.000,0,0');
  await page.locator('[id="node-page-31"]').click();
  const sourceLink = page.getByRole('link', { name: 'Open in VS Code' });
  await expect(sourceLink).toHaveAttribute('href', /^vscode:\/\/file\//);
  await expect(page.locator('.location').first()).toHaveText('pages/1.md:1:1');
  await expect(page.locator('.copy-location').first()).toHaveAttribute('data-location', 'pages/1.md:1:1');
});

test('dark mode and reduced motion retain a readable functional graph', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await openGraph(page);
  const background = await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor);
  expect(background).toBe('rgb(21, 24, 29)');
  const duration = await page.locator('#canvas svg .graph').evaluate(element => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(duration)).toBeLessThan(0.01);
  await page.locator('#zoom-in').click();
  await expect(page.locator('#canvas')).not.toHaveAttribute('data-view-state', '1.000,0,0');
});

test('hostile embedded text cannot break graph data or inject markup', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/.story-tools/authoring-escaping-test.html');
  await expect(page.locator('#canvas svg')).toBeVisible();
  await expect(page.locator('#injected')).toHaveCount(0);
  const title = await page.locator('#graph-data').evaluate(element => JSON.parse(element.textContent).project.title);
  expect(title).toContain('Äneas');
  expect(errors).toEqual([]);
});
