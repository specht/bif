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
    body: "export const path = 'test-fixtures/rewind-state';",
  }));
}

async function forceNormalMode(page, pollIntervalMs = null) {
  await page.route(/\/lib\/script\.js\?v=.*/, async route => {
    const source = await readFile(path.join(process.cwd(), 'lib/script.js'), 'utf8');
    await route.fulfill({
      contentType: 'text/javascript',
      body: source.replace(
        "let devMode = resolveBrowserMode() === 'dev';",
        'let devMode = false;',
      ).replace(
        'client: createBrowserAnalysisClient(),',
        pollIntervalMs === null
          ? 'client: createBrowserAnalysisClient(),'
          : `client: createBrowserAnalysisClient({ pollIntervalMs: ${pollIntervalMs} }),`,
      ),
    });
  });
}

async function usePollingInterval(page, pollIntervalMs = 50) {
  await page.route(/\/lib\/script\.js\?v=.*/, async route => {
    const source = await readFile(path.join(process.cwd(), 'lib/script.js'), 'utf8');
    await route.fulfill({
      contentType: 'text/javascript',
      body: source.replace(
        'client: createBrowserAnalysisClient(),',
        `client: createBrowserAnalysisClient({ pollIntervalMs: ${pollIntervalMs} }),`,
      ),
    });
  });
}

async function useAdaptiveTiming(page, fastRetryDelaysMs, monitorIntervalMs) {
  await page.route(/\/lib\/script\.js\?v=.*/, async route => {
    const source = await readFile(path.join(process.cwd(), 'lib/script.js'), 'utf8');
    await route.fulfill({
      contentType: 'text/javascript',
      body: source.replace(
        'client: createBrowserAnalysisClient(),',
        `client: createBrowserAnalysisClient({ fastRetryDelaysMs: ${JSON.stringify(fastRetryDelaysMs)}, monitorIntervalMs: ${monitorIntervalMs} }),`,
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

test('browser icon helper uses the allowlisted currentColor sprite safely', async ({ page }) => {
  await page.goto('/?mode=game');
  const result = await page.evaluate(async () => {
    const { createIcon } = await import('/lib/browser-icons.js');
    const icon = createIcon('check');
    document.body.append(icon);
    let error = '';
    try {
      createIcon('not-allowlisted');
    } catch (caught) {
      error = caught.message;
    }
    return {
      ariaHidden: icon.getAttribute('aria-hidden'),
      href: icon.querySelector('use')?.getAttribute('href'),
      error,
    };
  });
  expect(result).toEqual({
    ariaHidden: 'true',
    href: '/assets/icons.svg#icon-check',
    error: 'Unknown browser icon: not-allowlisted',
  });
});

test('background polling recovers from the Live Server publication race', async ({ page }) => {
  await useStoryFixture(page);
  await usePollingInterval(page);
  const validA = await fixture('valid-a.json');
  const validB = await fixture('valid-b.json');
  let newerPublicationAvailable = false;
  const getRequests = await analysisRoute(page, route => fulfillJson(route, newerPublicationAvailable ? validB : validA));

  await page.goto('/?dev');
  await expect(page.locator('#project-analysis-summary')).toContainText('13 pages');
  await page.locator('.pagelink', { hasText: 'Take route A' }).click();
  await expect(page.getByText('Route A set abandoned to true.')).toBeVisible();
  await page.getByRole('tab', { name: 'State' }).focus();
  const before = await page.evaluate(() => ({
    hash: location.hash,
    transcript: document.querySelector('#content').textContent,
    passages: document.querySelectorAll('.story-passage').length,
    runtime: document.querySelector('#state-container').textContent,
    route: [...document.querySelectorAll('#graph-container .active')].map(element => element.id),
    scrollTop: document.querySelector('#game_pane').scrollTop,
    focused: document.activeElement?.getAttribute('aria-label'),
    navigations: performance.getEntriesByType('navigation').length,
  }));

  newerPublicationAvailable = true;
  await expect(page.locator('#project-analysis-summary')).toContainText('14 pages');
  await expect(page.locator('#project-analysis-summary')).toContainText('2 errors');
  expect(getRequests()).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => ({
    hash: location.hash,
    transcript: document.querySelector('#content').textContent,
    passages: document.querySelectorAll('.story-passage').length,
    runtime: document.querySelector('#state-container').textContent,
    route: [...document.querySelectorAll('#graph-container .active')].map(element => element.id),
    scrollTop: document.querySelector('#game_pane').scrollTop,
    focused: document.activeElement?.getAttribute('aria-label'),
    navigations: performance.getEntriesByType('navigation').length,
  }))).toEqual(before);
});

test('adaptive sync stops fast retries after a change, then continues monitoring', async ({ page }) => {
  await useStoryFixture(page);
  await useAdaptiveTiming(page, [40, 40, 40], 240);
  const validA = await fixture('valid-a.json');
  const validB = await fixture('valid-b.json');
  const requestTimes = [];
  const getRequests = await analysisRoute(page, (route, request) => {
    requestTimes.push(performance.now());
    return fulfillJson(route, request === 1 ? validA : validB);
  });
  await page.goto('/?dev');
  await expect(page.locator('#project-analysis-summary')).toContainText('14 pages');
  expect(getRequests()).toBe(2);
  await page.waitForTimeout(130);
  expect(getRequests()).toBe(2);
  await expect.poll(getRequests).toBe(3);
  expect(requestTimes[1] - requestTimes[0]).toBeLessThan(400);
  expect(requestTimes[2] - requestTimes[1]).toBeGreaterThan(180);
});

test('adaptive sync window is bounded before monitoring cadence', async ({ page }) => {
  await useStoryFixture(page);
  await useAdaptiveTiming(page, [25, 35], 220);
  const getRequests = await analysisRoute(page, route => route.fulfill({ status: 404 }));
  await page.goto('/?dev');
  await expect.poll(getRequests).toBe(3);
  await page.waitForTimeout(120);
  expect(getRequests()).toBe(3);
  await expect.poll(getRequests).toBe(4);
});

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
  await expect(page.getByRole('button', { name: 'Refresh project analysis' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry' })).toBeHidden();
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

test('normal mode does not start background polling', async ({ page }) => {
  await useStoryFixture(page);
  await forceNormalMode(page, 40);
  let requests = 0;
  await page.route(/\/\.story-tools\/analysis\.json/, route => { requests += 1; return route.abort(); });

  await page.goto('/');
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 140)));
  expect(requests).toBe(0);
  await expect(page.locator('#project-analysis-summary')).toHaveCount(0);
  await page.locator('.pagelink', { hasText: 'Take route A' }).click();
  await expect(page.getByText('Route A set abandoned to true.')).toBeVisible();
});

test('explicit game mode suppresses development traffic and explicit dev mode enables it', async ({ page }) => {
  await useStoryFixture(page);
  await useAdaptiveTiming(page, [20, 20], 50);
  const valid = await fixture('valid-a.json');
  let requests = 0;
  await page.route(/\/\.story-tools\/analysis\.json/, route => {
    requests += 1;
    return fulfillJson(route, valid);
  });

  await page.goto('/?mode=game');
  await page.waitForTimeout(180);
  expect(requests).toBe(0);
  await expect(page.locator('#project-analysis-summary, #development-inspector')).toHaveCount(0);
  await page.locator('.pagelink', { hasText: 'Take route A' }).click();
  expect(new URL(page.url()).search).toBe('?mode=game');

  await page.goto('/?mode=dev');
  await expect(page.locator('#project-analysis-summary')).toContainText('13 pages');
  await expect(page.locator('#development-inspector')).toBeVisible();
  expect(requests).toBeGreaterThan(0);
});

test('unknown mode falls back to automatic development detection', async ({ page }) => {
  await useStoryFixture(page);
  const valid = await fixture('valid-a.json');
  const getRequests = await analysisRoute(page, route => fulfillJson(route, valid));
  await page.goto('/?mode=preview');
  await expect(page.locator('#project-analysis-summary')).toContainText('13 pages');
  expect(getRequests()).toBeGreaterThan(0);
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
  expect(requests).toBeGreaterThanOrEqual(1);
  expect(requests).toBeLessThanOrEqual(2);
  expect(consoleErrors.filter(message => !message.startsWith('Failed to load resource:'))).toEqual([]);
  expect(consoleErrors.filter(message => message.startsWith('Failed to load resource:'))).toHaveLength(requests);
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

test('contextual retry updates counters without touching story state', async ({ page }) => {
  await useStoryFixture(page);
  const validA = await fixture('valid-a.json');
  const validB = await fixture('valid-b.json');
  let recover = false;
  await analysisRoute(page, (route, request) => request === 1
    ? fulfillJson(route, validA)
    : recover ? fulfillJson(route, validB) : route.fulfill({ status: 503 }));
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

  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  recover = true;
  await page.getByRole('button', { name: 'Retry' }).click();
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
  await expect(page.getByRole('button', { name: 'Retry' })).toBeHidden();
});

test('unchanged hash keeps summary nodes and announcements stable', async ({ page }) => {
  await useStoryFixture(page);
  const valid = await fixture('valid-a.json');
  const getRequests = await analysisRoute(page, route => fulfillJson(route, valid));
  await page.goto('/?dev');
  const counts = page.locator('#project-analysis-counts');
  await expect(counts).toContainText('13 pages');
  const beforeHandle = await counts.elementHandle();
  const beforeStatus = await page.locator('#project-analysis-status').textContent();

  await expect.poll(getRequests).toBeGreaterThanOrEqual(2);
  const afterHandle = await counts.elementHandle();
  expect(await page.evaluate(([before, after]) => before === after, [beforeHandle, afterHandle])).toBe(true);
  expect(await page.locator('#project-analysis-status').textContent()).toBe(beforeStatus);
  await expect(page.getByRole('button', { name: 'Refresh project analysis' })).toHaveCount(0);
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
  const stateTab = page.getByRole('tab', { name: 'State' });
  await stateTab.focus();

  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(getRequests).toBe(2);
  await expect(stateTab).toBeFocused();
  expect(getRequests()).toBe(2);
});

test('active requests do not overlap and closely spaced triggers coalesce once', async ({ page }) => {
  await useStoryFixture(page);
  await usePollingInterval(page, 1000);
  const validA = await fixture('valid-a.json');
  const validB = await fixture('valid-b.json');
  let releaseActive;
  const activeHeld = new Promise(resolve => { releaseActive = resolve; });
  let active = 0;
  let maximumActive = 0;
  const getRequests = await analysisRoute(page, async (route, request) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    try {
      if (request === 1) return await fulfillJson(route, validA);
      if (request === 2) {
        await activeHeld;
        return await fulfillJson(route, validA);
      }
      return await fulfillJson(route, validB);
    } finally {
      active -= 1;
    }
  });
  await page.goto('/?dev');
  await expect(page.locator('#project-analysis-summary')).toContainText('13 pages');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(getRequests).toBe(2);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(getRequests()).toBe(2);
  expect(maximumActive).toBe(1);
  releaseActive();
  await expect.poll(getRequests).toBe(3);
  await expect(page.locator('#project-analysis-summary')).toContainText('14 pages');
  expect(maximumActive).toBe(1);
  expect(getRequests()).toBe(3);
});

test('an unavailable initial publication recovers through polling', async ({ page }) => {
  await useStoryFixture(page);
  await usePollingInterval(page);
  const valid = await fixture('valid-a.json');
  let available = false;
  const warnings = [];
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
  const getRequests = await analysisRoute(page, route => available
    ? fulfillJson(route, valid)
    : route.fulfill({ status: 404 }));

  await page.goto('/?dev');
  await expect(page.locator('#project-analysis-summary')).toContainText('Project analysis unavailable');
  available = true;
  await expect(page.locator('#project-analysis-summary')).toContainText('13 pages');
  expect(getRequests()).toBeGreaterThanOrEqual(2);
  expect(warnings).toEqual([]);
  await expect(page.locator('#graph-container svg')).toBeVisible();
});

test('polling pauses while hidden and refreshes immediately when visible', async ({ page }) => {
  await useStoryFixture(page);
  await usePollingInterval(page, 40);
  const valid = await fixture('valid-a.json');
  let holdVisibleRefresh = false;
  let releaseVisibleRefresh;
  const visibleRefreshHeld = new Promise(resolve => { releaseVisibleRefresh = resolve; });
  const getRequests = await analysisRoute(page, async route => {
    if (holdVisibleRefresh) await visibleRefreshHeld;
    return fulfillJson(route, valid);
  });
  await page.goto('/?dev');
  const stateTab = page.getByRole('tab', { name: 'State' });
  await stateTab.focus();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenCount = getRequests();
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 130)));
  expect(getRequests()).toBe(hiddenCount);

  holdVisibleRefresh = true;
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(getRequests).toBeGreaterThan(hiddenCount);
  expect(getRequests()).toBe(hiddenCount + 1);
  await expect(stateTab).toBeFocused();
  releaseVisibleRefresh();
  await expect.poll(getRequests).toBeGreaterThan(hiddenCount + 1);
});

test('repeated hashes stay stable, a new hash renders once, and polling continues', async ({ page }) => {
  await useStoryFixture(page);
  await usePollingInterval(page);
  const validA = await fixture('valid-a.json');
  const validB = await fixture('valid-b.json');
  let useB = false;
  const getRequests = await analysisRoute(page, route => fulfillJson(route, useB ? validB : validA));
  await page.goto('/?dev');
  const counts = page.locator('#project-analysis-counts');
  await expect(counts).toContainText('13 pages');
  const original = await counts.elementHandle();
  const originalStatus = await page.locator('#project-analysis-status').textContent();
  await page.locator('.project-analysis-pages').evaluate(element => {
    element.dataset.mutations = '0';
    new MutationObserver(() => {
      element.dataset.mutations = String(Number(element.dataset.mutations) + 1);
    }).observe(element, { childList: true, characterData: true, subtree: true });
  });
  await expect.poll(getRequests).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(([first, current]) => first === current, [original, await counts.elementHandle()])).toBe(true);
  expect(await page.locator('#project-analysis-status').textContent()).toBe(originalStatus);

  useB = true;
  await expect(counts).toContainText('14 pages');
  const updated = await counts.elementHandle();
  const requestsAfterUpdate = getRequests();
  await expect.poll(getRequests).toBeGreaterThan(requestsAfterUpdate);
  expect(await page.evaluate(([first, current]) => first === current, [updated, await counts.elementHandle()])).toBe(true);
  await expect(counts).toContainText('14 pages');
  await expect(page.locator('.project-analysis-pages')).toHaveAttribute('data-mutations', '1');
});

test('failed and malformed polls retain or recover analysis automatically', async ({ page }) => {
  await useStoryFixture(page);
  await usePollingInterval(page);
  const validA = await fixture('valid-a.json');
  const validB = await fixture('valid-b.json');
  let response = 'valid-a';
  const warnings = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error));
  const getRequests = await analysisRoute(page, route => {
    if (response === 'error') return route.fulfill({ status: 503 });
    if (response === 'malformed') return fulfillJson(route, '{broken');
    return fulfillJson(route, response === 'valid-b' ? validB : validA);
  });
  await page.goto('/?dev');
  await expect(page.locator('#project-analysis-summary')).toContainText('13 pages');
  response = 'error';
  await expect(page.locator('#project-analysis-summary')).toContainText('may be out of date');
  await expect(page.locator('#project-analysis-summary')).toContainText('13 pages');
  response = 'malformed';
  await expect.poll(() => warnings.filter(message => message.startsWith('Project analysis could not be read:')).length).toBe(2);
  const malformedRequests = getRequests();
  await expect.poll(getRequests).toBeGreaterThan(malformedRequests);
  expect(warnings.filter(message => message.startsWith('Project analysis could not be read:'))).toHaveLength(2);
  response = 'valid-b';
  await expect(page.locator('#project-analysis-summary')).toContainText('14 pages');
  await expect(page.locator('#project-analysis-summary')).not.toContainText('may be out of date');
  expect(pageErrors).toEqual([]);
});

test('disposing the client cancels scheduling, listeners, and obsolete responses', async ({ page }) => {
  const valid = JSON.parse(await fixture('valid-a.json'));
  await page.goto('/');
  const result = await page.evaluate(async model => {
    const { createBrowserAnalysisClient } = await import(`/lib/browser-analysis-client.js?dispose=${Date.now()}`);
    const fakeDocument = Object.assign(new EventTarget(), { hidden: false });
    const fakeWindow = new EventTarget();
    const timers = new Map();
    let nextTimer = 0;
    let requests = 0;
    const client = createBrowserAnalysisClient({
      documentObject: fakeDocument,
      windowObject: fakeWindow,
      pollIntervalMs: 10,
      fetchImplementation: async () => {
        requests += 1;
        return new Response(JSON.stringify(model), { status: 200 });
      },
      setTimeoutImplementation: callback => {
        const id = ++nextTimer;
        timers.set(id, callback);
        return id;
      },
      clearTimeoutImplementation: id => timers.delete(id),
    });
    await client.start();
    const scheduledBeforeDispose = timers.size;
    client.dispose();
    for (const callback of timers.values()) callback();
    fakeWindow.dispatchEvent(new Event('focus'));
    fakeDocument.dispatchEvent(new Event('visibilitychange'));

    let release;
    const held = new Promise(resolve => { release = resolve; });
    const obsoleteStates = [];
    const obsolete = createBrowserAnalysisClient({
      documentObject: fakeDocument,
      windowObject: fakeWindow,
      fetchImplementation: async () => {
        await held;
        return new Response(JSON.stringify(model), { status: 200 });
      },
      setTimeoutImplementation: callback => {
        const id = ++nextTimer;
        timers.set(id, callback);
        return id;
      },
      clearTimeoutImplementation: id => timers.delete(id),
    });
    obsolete.subscribe(state => obsoleteStates.push(state.status));
    const obsoleteRequest = obsolete.start();
    obsolete.dispose();
    release();
    await obsoleteRequest;
    return { requests, scheduledBeforeDispose, timersAfterDispose: timers.size, obsoleteStates };
  }, valid);

  expect(result).toEqual({
    requests: 1,
    scheduledBeforeDispose: 1,
    timersAfterDispose: 0,
    obsoleteStates: ['idle', 'loading'],
  });
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

test('source snippet model handles tabs and hostile source without injection', async ({ page }) => {
  await page.goto('/?mode=game');
  const result = await page.evaluate(async () => {
    const module = await import(`/lib/browser-source-snippet.js?test=${Date.now()}`);
    const source = '\tconst value = "</script><img src=x onerror=globalThis.injected=true>";';
    const model = module.buildSourceSnippet(source, { line: 1, column: 2, endColumn: 7 });
    const rendered = module.renderSourceSnippet(model, 'pages/1.md');
    document.body.append(rendered);
    return {
      column: model.diagnosticColumn,
      markerClass: rendered.querySelector('.problem-source-range').className,
      images: rendered.querySelectorAll('img').length,
      scripts: rendered.querySelectorAll('script').length,
      text: rendered.textContent,
    };
  });
  expect(result.column).toBe(5);
  expect(result.markerClass).toContain('exact');
  expect(result.images).toBe(0);
  expect(result.scripts).toBe(0);
  expect(result.text).toContain('</script><img');
  expect(await page.evaluate(() => globalThis.injected)).toBeUndefined();
});

test('source snippets trim only blank outer context while preserving source lines', async ({ page }) => {
  await page.goto('/?mode=game');
  const models = await page.evaluate(async () => {
    const { buildSourceSnippet } = await import(`/lib/browser-source-snippet.js?trim=${Date.now()}`);
    return {
      context: buildSourceSnippet('\nalpha\n\nbad\n\nomega\n', { line: 4, column: 1 }, 3),
      blankDiagnostic: buildSourceSnippet('alpha\n\n   \n\nomega', { line: 3 }, 2),
      first: buildSourceSnippet('bad\n\n\n', { line: 1 }, 2),
      last: buildSourceSnippet('\n\nbad', { line: 3 }, 2),
    };
  });
  expect(models.context).toMatchObject({ startLine: 2, endLine: 6, diagnosticLine: 4, lines: ['alpha', '', 'bad', '', 'omega'] });
  expect(models.blankDiagnostic.lines).toEqual(['alpha', '', '   ', '', 'omega']);
  expect(models.first).toMatchObject({ startLine: 1, endLine: 1, lines: ['bad'] });
  expect(models.last).toMatchObject({ startLine: 3, endLine: 3, lines: ['bad'] });
});

test('summary is keyboard accessible and reduced-motion safe', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await useStoryFixture(page);
  const valid = await fixture('valid-a.json');
  await analysisRoute(page, route => fulfillJson(route, valid));
  await page.goto('/?dev');
  const stateTab = page.getByRole('tab', { name: 'State' });
  await expect(stateTab).toBeVisible();
  await page.getByRole('link', { name: 'Take route B' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Restart' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Fit graph' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Auto-follow' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('separator', { name: 'Resize development inspector' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(stateTab).toBeFocused();
  await expect(page.locator('#project-analysis-status')).toHaveAttribute('aria-live', 'polite');
  const styles = await stateTab.evaluate(element => ({
    transition: getComputedStyle(element).transitionDuration,
    outline: getComputedStyle(element).outlineStyle,
  }));
  expect(styles.transition).toBe('0s');
  expect(styles.outline).not.toBe('none');
});

test('graph viewport math keeps wheel and pinch focal points anchored', async ({ page }) => {
  await page.goto('/?mode=game');
  const result = await page.evaluate(async () => {
    const viewport = await import(`/lib/browser-graph-viewport.js?math=${Date.now()}`);
    const box = { left: 100, top: 50, width: 800, height: 400 };
    const start = { x: -200, y: 20, width: 1600, height: 800 };
    const point = { x: 260, y: 170 };
    const before = viewport.clientPointToWorld(start, box, point);
    const zoomed = viewport.zoomViewBoxAt(start, box, point, 0.6, { minWidth: 200, maxWidth: 4000 });
    const after = viewport.clientPointToWorld(zoomed, box, point);
    const restored = viewport.zoomViewBoxAt(zoomed, box, point, 1 / 0.6, { minWidth: 200, maxWidth: 4000 });
    const pinch = viewport.pinchViewBox(start, box,
      { midpoint: { x: 300, y: 200 }, distance: 100 },
      { midpoint: { x: 340, y: 225 }, distance: 160 },
      { minWidth: 200, maxWidth: 4000 });
    const oldPinchWorld = viewport.clientPointToWorld(start, box, { x: 300, y: 200 });
    const newPinchWorld = viewport.clientPointToWorld(pinch, box, { x: 340, y: 225 });
    const visibleFollow = viewport.followViewBoxTarget({ x: 0, y: 0, width: 1000, height: 500 }, { x: 300, y: 180, width: 100, height: 50 });
    const distantFollow = viewport.followViewBoxTarget({ x: 0, y: 0, width: 1000, height: 500 }, { x: 1200, y: 200, width: 100, height: 50 });
    const oversizedFollow = viewport.followViewBoxTarget({ x: 0, y: 0, width: 200, height: 100 }, { x: 300, y: 100, width: 220, height: 80 }, { maxWidth: 600 });
    return { before, after, restored, start, pinch, oldPinchWorld, newPinchWorld, visibleFollow, distantFollow, oversizedFollow };
  });
  expect(result.after.x).toBeCloseTo(result.before.x, 8);
  expect(result.after.y).toBeCloseTo(result.before.y, 8);
  for (const key of ['x', 'y', 'width', 'height']) expect(result.restored[key]).toBeCloseTo(result.start[key], 8);
  expect(result.pinch.width).toBeLessThan(result.start.width);
  expect(result.newPinchWorld.x).toBeCloseTo(result.oldPinchWorld.x, 8);
  expect(result.newPinchWorld.y).toBeCloseTo(result.oldPinchWorld.y, 8);
  expect(result.visibleFollow).toBeNull();
  expect(result.distantFollow.width).toBe(1000);
  expect(result.distantFollow.x).toBeCloseTo(450, 8);
  expect(result.oversizedFollow.width).toBeGreaterThan(200);
  expect(result.oversizedFollow.width).toBeLessThanOrEqual(600);
});
