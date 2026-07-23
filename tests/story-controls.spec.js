import { expect, test } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const root = process.cwd();

async function useStory(page, storyPath = 'test-fixtures/player-basic/pages') {
  await page.route(/\/config\.js(?:\?.*)?$/, route => route.fulfill({
    contentType: 'text/javascript', body: `export const path = '${storyPath}';`,
  }));
}

test('compact controls are accessible chrome outside the transcript in both local views', async ({ page }) => {
  await useStory(page);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/?mode=game');
  const toolbar = page.getByLabel('Story controls');
  const restart = page.getByRole('button', { name: 'Restart story' });
  const authoring = page.getByRole('button', { name: 'Open authoring view' });
  await expect(restart).toHaveAttribute('title', 'Restart story');
  await expect(authoring).toHaveAttribute('title', 'Open authoring view');
  await expect(restart.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await expect(authoring.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await expect(restart).toHaveText('');
  await expect(authoring).toHaveText('');
  expect(await toolbar.evaluate(element => !document.querySelector('#content').contains(element))).toBe(true);
  const geometry = await page.evaluate(() => {
    const layer = document.querySelector('.story-controls-layer').getBoundingClientRect();
    const controls = document.querySelector('.story-controls').getBoundingClientRect();
    const pane = document.querySelector('#game_pane').getBoundingClientRect();
    const restart = document.querySelector('.story-restart-control').getBoundingClientRect();
    return { layerHeight: layer.height, controlsRight: controls.right, paneRight: pane.right, size: restart.width };
  });
  expect(geometry.layerHeight).toBe(0);
  expect(geometry.controlsRight).toBeLessThan(geometry.paneRight);
  expect(geometry.size).toBeGreaterThanOrEqual(32);
  expect(geometry.size).toBeLessThanOrEqual(40);
  await restart.focus();
  await expect(restart).toBeFocused();
  await page.goto('/?mode=dev');
  await expect(page.getByRole('button', { name: 'Restart story' })).toBeVisible();
  const game = page.getByRole('button', { name: 'Open game view' });
  await expect(game).toHaveAttribute('title', 'Open game view');
  await expect(game).toHaveText('');
  expect(await page.locator('.story-controls').evaluate(element => element.closest('#game_pane') !== null)).toBe(true);
});

test('restart before progress skips confirmation and never duplicates controls', async ({ page }) => {
  await useStory(page);
  await page.addInitScript(() => {
    window.__confirmCalls = [];
    window.confirm = message => { window.__confirmCalls.push(message); return true; };
  });
  await page.goto('/?mode=game');
  await page.getByRole('button', { name: 'Restart story' }).click();
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
  expect(await page.evaluate(() => window.__confirmCalls)).toEqual([]);
  await page.getByRole('button', { name: 'Restart story' }).click();
  await expect(page.locator('.story-controls')).toHaveCount(1);
  await expect(page.locator('.story-restart-control')).toHaveCount(1);
  await expect(page.locator('#content .story-restart-control, #content .story-play-again')).toHaveCount(0);
});

test('progress restart confirms, cancellation preserves the session, and acceptance resets it', async ({ page }) => {
  await useStory(page);
  await page.addInitScript(() => {
    window.__confirmResult = false;
    window.__confirmMessages = [];
    window.confirm = message => { window.__confirmMessages.push(message); return window.__confirmResult; };
  });
  await page.goto('/?mode=game');
  await page.getByRole('link', { name: 'Take the direct route.' }).click();
  await expect(page.getByRole('heading', { name: 'Destination' })).toBeVisible();
  const progressedUrl = page.url();
  await page.getByRole('button', { name: 'Restart story' }).click();
  await expect(page.getByRole('heading', { name: 'Destination' })).toBeVisible();
  expect(page.url()).toBe(progressedUrl);
  expect(await page.evaluate(() => window.__confirmMessages)).toEqual([
    'Restart the story? Your current progress will be lost.',
  ]);

  await page.evaluate(() => { window.__confirmResult = true; });
  await page.getByRole('button', { name: 'Restart story' }).click();
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
  const session = await page.evaluate(() => JSON.parse(LZString.decompressFromEncodedURIComponent(location.hash.slice(1))));
  expect(session.events).toEqual([{ type: 'page', pageId: '1' }]);
  await expect(page.getByRole('button', { name: 'Restart story' })).toBeFocused();
});

test('local choices and context are cleared by the shared restart action', async ({ page }) => {
  await useStory(page, 'test-fixtures/choice-results/pages');
  await page.addInitScript(() => { window.confirm = () => true; });
  await page.goto('/?mode=dev');
  await page.getByRole('button', { name: 'Ask whether he travels often.' }).click();
  await expect(page.getByText(/Every Thursday.*Result 1/)).toBeVisible();
  await expect(page.locator('.committed-choice-turn')).toHaveCount(1);
  await expect(page.locator('#state-container')).toContainText('knows_answer: true');
  await page.getByRole('button', { name: 'Restart story' }).click();
  await expect(page.locator('.committed-choice-turn')).toHaveCount(0);
  await expect(page.getByText(/Every Thursday.*Result 1/)).toHaveCount(0);
  await expect(page.locator('#state-container')).toContainText('knows_answer: false');
});

test('ending Play again stays outside authored content and uses the shared restart', async ({ page }) => {
  await useStory(page);
  await page.addInitScript(() => { window.confirm = () => true; });
  await page.goto('/?mode=game');
  await expect(page.locator('.story-ending-actions')).toBeHidden();
  await page.getByRole('link', { name: 'Take the direct route.' }).click();
  const playAgain = page.getByRole('button', { name: 'Play again' });
  await expect(playAgain).toBeVisible();
  expect(await playAgain.evaluate(element => !document.querySelector('#content').contains(element))).toBe(true);
  await playAgain.click();
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
});

test('production exposes restart but no view toggle or authoring request', async ({ browser }) => {
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
  await expect(page.getByRole('button', { name: 'Restart story' })).toBeVisible();
  await expect(page.locator('.story-view-toggle')).toHaveCount(0);
  expect(devRequests).toEqual([]);
  await context.close();
});
