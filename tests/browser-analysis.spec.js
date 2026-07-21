import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const fixtureRoot = path.join(process.cwd(), 'test-fixtures/browser-analysis');

async function fixture(name) {
  return readFile(path.join(fixtureRoot, name), 'utf8');
}

async function useStoryFixture(page) {
  await page.route(/\/config\.js\?.*/, route => route.fulfill({
    contentType: 'text/javascript',
    body: "export const title = 'Analysis fixture'; export const path = 'test-fixtures/rewind-state';",
  }));
}

async function forceNormalMode(page) {
  await page.route(/\/lib\/script\.js\?v=.*/, async route => {
    const source = await readFile(path.join(process.cwd(), 'lib/script.js'), 'utf8');
    await route.fulfill({
      contentType: 'text/javascript',
      body: source.replace(
        "let devMode = (window.location.port.length > 0) || (window.location.search.indexOf('dev') > 0);",
        'let devMode = false;',
      ),
    });
  });
}

function analysisRoute(page, responder) {
  let requests = 0;
  return page.route(/\/\.story-tools\/analysis\.json\?v=\d+$/, async route => {
    requests += 1;
    await responder(route, requests);
  }).then(() => () => requests);
}

async function fulfillJson(route, body) {
  await route.fulfill({ contentType: 'application/json', body });
}

async function expectPlayerUsable(page) {
  await expect(page.locator('#graph-container svg')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rewind state fixture' })).toBeVisible();
  await page.locator('.pagelink', { hasText: 'Take route A' }).click();
  await expect(page.getByText('Route A set abandoned to true.')).toBeVisible();
}

test('development mode loads valid analysis without changing the player', async ({ page }) => {
  await useStoryFixture(page);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const valid = await fixture('valid-a.json');
  let requestedUrl;
  await analysisRoute(page, async route => {
    requestedUrl = route.request().url();
    await held;
    await fulfillJson(route, valid);
  });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error));

  await page.goto('/?dev');
  await expect(page.getByRole('heading', { name: 'Rewind state fixture' })).toBeVisible();
  const before = await page.evaluate(() => ({ hash: location.hash, passages: document.querySelectorAll('.story-passage').length }));
  release();

  await expect(page.locator('#project-analysis-summary')).toContainText('13 pages');
  await expect(page.locator('#project-analysis-summary')).toContainText('21 choices');
  await expect(page.locator('#project-analysis-summary')).toContainText('1 warning');
  await expect(page.locator('#project-analysis-summary')).toContainText('2 missing targets');
  await expect(page.getByRole('button', { name: 'Refresh project analysis' })).toBeVisible();
  await expect(page.locator('#graph-container svg')).toBeVisible();
  expect(requestedUrl).toContain('/.story-tools/analysis.json?v=');
  expect(await page.evaluate(() => ({ hash: location.hash, passages: document.querySelectorAll('.story-passage').length }))).toEqual(before);
  expect(pageErrors).toEqual([]);
  const bounds = await page.locator('#dev_fixed').evaluate(element => ({ bottom: element.getBoundingClientRect().bottom, viewport: innerHeight }));
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewport);
});

test('normal mode makes no analysis request and playback still works', async ({ page }) => {
  await useStoryFixture(page);
  await forceNormalMode(page);
  let requests = 0;
  const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.route(/\/\.story-tools\/analysis\.json/, route => { requests += 1; return route.abort(); });

  await page.goto('/');
  await expect(page.locator('#project-analysis-summary')).toHaveCount(0);
  await page.locator('.pagelink', { hasText: 'Take route A' }).click();
  await expect(page.getByText('Route A set abandoned to true.')).toBeVisible();
  expect(requests).toBe(0);
  expect(consoleErrors).toEqual([]);
});

test('missing analysis is a quiet unavailable state', async ({ page }) => {
  await useStoryFixture(page);
  let requests = 0;
  await page.route(/\/\.story-tools\/analysis\.json/, route => { requests += 1; return route.fulfill({ status: 404 }); });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error));

  await page.goto('/?dev');
  await expect(page.locator('#project-analysis-summary')).toContainText('Project analysis unavailable');
  await expectPlayerUsable(page);
  expect(requests).toBe(1);
  expect(consoleErrors.filter(message => !message.startsWith('Failed to load resource:'))).toEqual([]);
  expect(consoleErrors.filter(message => message.startsWith('Failed to load resource:'))).toHaveLength(1);
  expect(pageErrors).toEqual([]);
  await expect(page.locator('.story-error')).toHaveCount(0);
});

for (const [name, response, reason] of [
  ['malformed JSON', 'malformed.json', 'invalid JSON'],
  ['unsupported schema', 'unsupported.json', 'unsupported schema'],
  ['invalid summary', 'invalid-summary.json', 'invalid summary'],
]) {
  test(`${name} is contained`, async ({ page }) => {
    await useStoryFixture(page);
    const body = await fixture(response);
    await analysisRoute(page, route => fulfillJson(route, body));
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error));
    await page.goto('/?dev');
    await expect(page.locator('#project-analysis-summary')).toContainText('Project analysis could not be read');
    await expect(page.locator('#project-analysis-summary')).toContainText(reason);
    await expectPlayerUsable(page);
    expect(pageErrors).toEqual([]);
  });
}

test('manual refresh updates counters without touching story state', async ({ page }) => {
  await useStoryFixture(page);
  const responses = [await fixture('valid-a.json'), await fixture('valid-b.json')];
  await analysisRoute(page, (route, request) => fulfillJson(route, responses[Math.min(request - 1, 1)]));
  await page.goto('/?dev');
  await expect(page.locator('#project-analysis-summary')).toContainText('13 pages');
  await page.locator('.pagelink', { hasText: 'Take route A' }).click();
  await expect(page.getByText('Route A set abandoned to true.')).toBeVisible();
  const before = await page.evaluate(() => ({
    hash: location.hash,
    currentPage: document.querySelector('.story-passage:last-of-type')?.dataset.pageId,
    transcript: document.querySelector('#content').textContent,
    passages: document.querySelectorAll('.story-passage').length,
    runtime: document.querySelector('#state-container').textContent,
    route: [...document.querySelectorAll('#graph-container .active')].map(element => element.id),
    scrollTop: document.querySelector('#game_pane').scrollTop,
  }));

  await page.getByRole('button', { name: 'Refresh project analysis' }).click();
  await expect(page.locator('#project-analysis-summary')).toContainText('14 pages');
  await expect(page.locator('#project-analysis-summary')).toContainText('2 errors');
  const after = await page.evaluate(() => ({
    hash: location.hash,
    currentPage: document.querySelector('.story-passage:last-of-type')?.dataset.pageId,
    transcript: document.querySelector('#content').textContent,
    passages: document.querySelectorAll('.story-passage').length,
    runtime: document.querySelector('#state-container').textContent,
    route: [...document.querySelectorAll('#graph-container .active')].map(element => element.id),
    scrollTop: document.querySelector('#game_pane').scrollTop,
  }));
  expect(after).toEqual(before);
  await expect(page.getByRole('button', { name: 'Refresh project analysis' })).toBeFocused();
});

test('unchanged hash keeps summary nodes and announcements stable', async ({ page }) => {
  await useStoryFixture(page);
  const valid = await fixture('valid-a.json');
  await analysisRoute(page, route => fulfillJson(route, valid));
  await page.goto('/?dev');
  const counts = page.locator('#project-analysis-counts');
  await expect(counts).toContainText('13 pages');
  const beforeHandle = await counts.elementHandle();
  const beforeStatus = await page.locator('#project-analysis-status').textContent();

  await page.getByRole('button', { name: 'Refresh project analysis' }).click();
  await expect(page.getByRole('button', { name: 'Refresh project analysis' })).toHaveAttribute('aria-busy', 'false');
  const afterHandle = await counts.elementHandle();
  expect(await page.evaluate(([before, after]) => before === after, [beforeHandle, afterHandle])).toBe(true);
  expect(await page.locator('#project-analysis-status').textContent()).toBe(beforeStatus);
  await expect(page.getByRole('button', { name: 'Refresh project analysis' })).toBeFocused();
});

test('failed refresh retains the last valid summary and marks it stale', async ({ page }) => {
  await useStoryFixture(page);
  const valid = await fixture('valid-a.json');
  await analysisRoute(page, (route, request) => request === 1
    ? fulfillJson(route, valid)
    : route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/?dev');
  await expect(page.locator('#project-analysis-summary')).toContainText('13 pages');
  const transcript = await page.locator('#content').textContent();

  await page.getByRole('button', { name: 'Refresh project analysis' }).click();
  await expect(page.locator('#project-analysis-summary')).toContainText('may be out of date');
  await expect(page.locator('#project-analysis-summary')).toContainText('13 pages');
  expect(await page.locator('#content').textContent()).toBe(transcript);
  await expect(page.locator('#graph-container svg')).toBeVisible();
});

test('focus and visibility refreshes are debounced without moving focus', async ({ page }) => {
  await useStoryFixture(page);
  const valid = await fixture('valid-a.json');
  const getRequests = await analysisRoute(page, route => fulfillJson(route, valid));
  await page.goto('/?dev');
  const refresh = page.getByRole('button', { name: 'Refresh project analysis' });
  await expect(refresh).toHaveAttribute('aria-busy', 'false');
  await refresh.focus();

  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(getRequests).toBe(2);
  await expect(refresh).toBeFocused();
  expect(getRequests()).toBe(2);
});

test('an older request resolving last cannot replace newer analysis', async ({ page }) => {
  await useStoryFixture(page);
  const validA = await fixture('valid-a.json');
  const validB = await fixture('valid-b.json');
  let releaseOlder;
  const olderHeld = new Promise(resolve => { releaseOlder = resolve; });
  await analysisRoute(page, async (route, request) => {
    if (request === 1) return fulfillJson(route, validA);
    if (request === 2) {
      await olderHeld;
      return fulfillJson(route, validA);
    }
    return fulfillJson(route, validB);
  });
  await page.goto('/?dev');
  const refresh = page.getByRole('button', { name: 'Refresh project analysis' });
  await expect(page.locator('#project-analysis-summary')).toContainText('13 pages');
  await refresh.click();
  await refresh.click();
  await expect(page.locator('#project-analysis-summary')).toContainText('14 pages');
  releaseOlder();
  await expect(refresh).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#project-analysis-summary')).toContainText('14 pages');
});

test('hostile publication text is rendered as inert text', async ({ page }) => {
  await useStoryFixture(page);
  const hostile = await fixture('hostile.json');
  await analysisRoute(page, route => fulfillJson(route, hostile));
  await page.goto('/?dev');
  await expect(page.locator('#project-analysis-title')).toContainText('</script><img');
  await expect(page.locator('#project-analysis-summary img')).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.analysisInjected)).toBeUndefined();
  await expect(page.locator('#project-analysis-summary')).toContainText('1 page');
});

test('summary is keyboard accessible and reduced-motion safe', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await useStoryFixture(page);
  const valid = await fixture('valid-a.json');
  await analysisRoute(page, route => fulfillJson(route, valid));
  await page.goto('/?dev');
  const refresh = page.getByRole('button', { name: 'Refresh project analysis' });
  await expect(refresh).toBeVisible();
  await page.getByRole('link', { name: 'Take route B' }).focus();
  await page.keyboard.press('Tab');
  await expect(refresh).toBeFocused();
  await expect(page.locator('#project-analysis-status')).toHaveAttribute('aria-live', 'polite');
  const styles = await refresh.evaluate(element => ({
    transition: getComputedStyle(element).transitionDuration,
    outline: getComputedStyle(element).outlineStyle,
  }));
  expect(styles.transition).toBe('0s');
  expect(styles.outline).not.toBe('none');
});
