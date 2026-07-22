import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error));
  return errors;
}

async function useFixture(page, title, path) {
  await page.route(/\/config\.js\?.*/, route => route.fulfill({
    contentType: 'text/javascript',
    body: `export const path = ${JSON.stringify(path)};`,
  }));
}

async function useScrollFixture(page, { normalMode = false } = {}) {
  await useFixture(page, 'Transcript scrolling fixture', 'test-fixtures/transcript-scroll');
  if (normalMode) {
    await page.route(/\/lib\/script\.js\?v=.*/, async route => {
      const source = await readFile(path.join(process.cwd(), 'lib/script.js'), 'utf8');
      await route.fulfill({
        contentType: 'text/javascript',
        body: source.replace(
          "let devMode = resolveBrowserMode() === 'dev';",
          'let devMode = false;',
        ),
      });
    });
  }
  const filler = Array.from({ length: 18 }, (_, index) => `Paragraph ${index + 1}: ${'long transcript content '.repeat(8)}`).join('\n\n');
  const pages = {
    '1': `# Scroll fixture start\n\n${filler}\n\n- [Continue by ordinary choice](2)\n- [Rejected choice](4)`,
    '2': `## Ordinary scroll destination\n\n${filler}\n\n- [Open scripted choice](3)`,
    '3': `## Scripted scroll passage\n\n${filler}\n\n<script>\nconst answer = await presentChoice([['accept', 'Accept scripted choice'], ['reject', 'Reject scripted choice']]);\nprint('Settled scripted output: ' + answer);\nawait goToPage('5');\n</script>\n\n<div condition="false">[Graph destination](5)</div>`,
    '4': '# Rejected destination',
    '5': `## Programmatic scroll destination\n\n${filler}\n\nFinal scripted destination.`,
  };
  await page.route(/\/test-fixtures\/transcript-scroll\/([^/?]+)\.md\?.*/, route => {
    const pageId = new URL(route.request().url()).pathname.split('/').pop().replace(/\.md$/, '');
    return pages[pageId]
      ? route.fulfill({ contentType: 'text/markdown', body: pages[pageId] })
      : route.fulfill({ status: 404, body: 'Missing fixture page' });
  });
}

async function passageIsVisible(page, pageId) {
  return page.locator(`.story-passage[data-page-id="${pageId}"]`).evaluate(element => {
    const rect = element.getBoundingClientRect();
    const viewport = document.body.classList.contains('dev')
      ? document.querySelector('#game_pane').getBoundingClientRect()
      : { top: 0, bottom: window.innerHeight };
    return rect.top >= viewport.top && rect.top < viewport.bottom;
  });
}

test('initial page renders', async ({ page }) => {
  const pageErrors = collectPageErrors(page);

  await page.goto('/');

  await expect(page).toHaveTitle('Die List des Odysseus');
  await expect(page.locator('#content')).not.toContainText('title: Die List des Odysseus');
  await expect(page.getByText('Du bist Odysseus', { exact: false })).toBeVisible();
  await expect(page.getByText('Du gehst mit', { exact: false })).toBeVisible();
  await expect(page.locator('.pagelink')).not.toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('game mode derives the title from the first H1 without analysis', async ({ page }) => {
  const analysisRequests = [];
  page.on('request', request => { if (request.url().includes('analysis.json')) analysisRequests.push(request.url()); });
  await useFixture(page, 'ignored config title', 'test-fixtures/rewind-state');
  await page.goto('/?mode=game');
  await expect(page).toHaveTitle('Rewind state fixture');
  expect(analysisRequests).toEqual([]);
});

test('a broken entry passage remains a recoverable game-mode failure', async ({ page }) => {
  const analysisRequests = [];
  page.on('request', request => { if (request.url().includes('analysis.json')) analysisRequests.push(request.url()); });
  await useFixture(page, 'Broken entry fixture', 'test-fixtures/broken-entry/pages');
  await page.goto('/?mode=game');
  await expect(page).toHaveTitle('Broken entry fixture');
  await expect(page.locator('#content .story-error')).toHaveText('This part of the story could not be loaded.');
  await expect(page.locator('#content .story-error')).toHaveCount(1);
  await expect(page.locator('#content')).not.toContainText(/test-fixtures|line 8|script|SyntaxError|ReferenceError|crew_count|later prose|Forbidden later choice|\{\}/i);
  await expect(page.locator('#content > .story-restart')).toBeVisible();
  await expect(page.locator('#development-inspector, #graph-panel')).toHaveCount(0);
  expect(analysisRequests).toEqual([]);
});

test('invalid mandatory configuration still uses the fatal application fallback', async ({ page }) => {
  await page.route(/\/config\.js\?.*/, route => route.fulfill({
    contentType: 'text/javascript',
    body: 'throw new Error("invalid fixture configuration");',
  }));
  await page.goto('/?mode=dev');
  await expect(page.locator('#fatal-application-error')).toHaveText('The story application could not be started.');
  await expect(page.locator('#content, #development-inspector')).toHaveCount(0);
});

test('choosing a page appends its passage to the transcript', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.goto('/');
  const initialHash = new URL(page.url()).hash;
  const selectedChoice = page.getByText('Du untersuchst zunächst den Höhleneingang.');
  const rejectedChoice = page.getByText('Du gehst direkt in die Höhle.');

  await selectedChoice.click();

  await expect(page.getByText('Du bist Odysseus', { exact: false })).toBeVisible();
  await expect(selectedChoice).toBeVisible();
  await expect(selectedChoice.locator('xpath=ancestor::*[contains(@class, "pagelink")]')).toHaveClass(/chosen/);
  await expect(rejectedChoice.locator('xpath=ancestor::*[contains(@class, "pagelink")]')).toHaveClass(/dismissed/);
  await expect(page.getByText('Du umkreist vorsichtig den Höhleneingang', { exact: false })).toBeVisible();
  expect(new URL(page.url()).hash).not.toBe(initialHash);
  expect(pageErrors).toEqual([]);
});

test('explicit development mode survives history, reload, rewind, and restart', async ({ page }) => {
  await page.goto('/?mode=dev');
  await expect(page.locator('#development-inspector')).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash.length)).toBeGreaterThan(1);
  const initialUrl = page.url();
  await page.getByText('Du untersuchst zunächst den Höhleneingang.').click();
  await expect(page).not.toHaveURL(initialUrl);
  expect(new URL(page.url()).search).toBe('?mode=dev');
  const middleUrl = page.url();
  await page.getByText('Weiter…').click();
  await expect(page).not.toHaveURL(middleUrl);
  await page.goBack();
  await expect(page).toHaveURL(middleUrl);
  expect(new URL(page.url()).search).toBe('?mode=dev');
  await page.goForward();
  expect(new URL(page.url()).search).toBe('?mode=dev');
  await page.reload();
  expect(new URL(page.url()).search).toBe('?mode=dev');
  await page.locator('#node_1').click();
  expect(new URL(page.url()).search).toBe('?mode=dev');
  await page.locator('#bu_reset_game').click();
  await expect(page.locator('#development-inspector')).toBeVisible();
  expect(new URL(page.url()).search).toBe('?mode=dev');
});

test('graph rewind clears variables from an abandoned route', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await useFixture(page, 'Rewind state fixture', 'test-fixtures/rewind-state');

  await page.goto('/?dev');
  await page.locator('.pagelink', { hasText: 'Take route A' }).click();
  await expect(page.getByText('Route A set abandoned to true.')).toBeVisible();
  await expect(page.locator('#state-container')).toContainText('abandoned: true');

  await expect(page.locator('#node_1')).toBeVisible();
  await page.locator('#node_1').click({ force: true });
  await expect(page.locator('.pagelink', { hasText: 'Take route B' })).toBeVisible();
  await page.locator('.pagelink', { hasText: 'Take route B' }).click();

  await expect(page.getByText('State after rewind: undefined')).toBeVisible();
  await expect(page.getByText('Function after rewind: undefined')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('scripted choice is usable while its script is suspended', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await useFixture(page, 'Async navigation fixture', 'test-fixtures/async-navigation');

  await page.goto('/?dev');
  await expect(page.getByRole('heading', { name: 'Async navigation fixture' })).toBeVisible();
  const selected = page.getByRole('button', { name: 'Inspect the machine' });
  const rejected = page.getByRole('button', { name: 'Leave it alone' });
  await expect(selected).toBeVisible();
  await expect(rejected).toBeVisible();
  await expect(page.getByText('Continuation resumed with inspect.')).toHaveCount(0);

  await selected.click();

  await expect(page.getByText('Continuation resumed with inspect.')).toBeVisible();
  await expect(page.getByText('Continuation resumed with inspect.')).toHaveCount(1);
  await expect(page.locator('#state-container')).toContainText('resumed_answer: inspect');
  await expect(selected).toBeVisible();
  await expect(selected).toHaveClass(/chosen/);
  await expect(rejected).toHaveClass(/dismissed/);
  expect(pageErrors).toEqual([]);
});

test('scripted choice and continuation replay without prompting again', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await useFixture(page, 'Async navigation fixture', 'test-fixtures/async-navigation');
  await page.goto('/?dev');
  await page.getByRole('button', { name: 'Inspect the machine' }).click();
  await expect(page.getByRole('heading', { name: 'Programmatic destination' })).toBeVisible();
  const replayUrl = page.url();

  await page.goto(replayUrl);

  await expect(page.getByText('Continuation resumed with inspect.')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Programmatic destination' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Inspect the machine' })).toHaveClass(/chosen/);
  await expect(page.getByRole('button', { name: 'Leave it alone' })).toHaveClass(/dismissed/);
  expect(pageErrors).toEqual([]);
});

test('goToPage performs one normal story transition', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await useFixture(page, 'Async navigation fixture', 'test-fixtures/async-navigation');
  await page.goto('/?dev');
  const initialHash = new URL(page.url()).hash;

  await page.getByRole('button', { name: 'Inspect the machine' }).click();

  await expect(page.getByText('The source passage is mounted', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inspect the machine' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Programmatic destination' })).toHaveCount(1);
  await expect(page.getByText('The destination passage was appended exactly once.')).toHaveCount(1);
  await expect(page.locator('#node_2')).toHaveClass(/active/);
  const restart = page.getByRole('button', { name: 'Restart' });
  await expect(restart).toHaveCount(1);
  expect(await restart.evaluate(element => element.parentElement.classList.contains('development-toolbar-actions'))).toBe(true);
  const restartAlignment = await restart.evaluate(element => {
    const icon = element.querySelector('.icon').getBoundingClientRect();
    const label = element.querySelector('span').getBoundingClientRect();
    return { difference: Math.abs((icon.top + icon.bottom) / 2 - (label.top + label.bottom) / 2), display: getComputedStyle(element).display, html: element.innerHTML };
  });
  expect(restartAlignment.difference, JSON.stringify(restartAlignment)).toBeLessThanOrEqual(2);
  const overlap = await page.evaluate(() => {
    const restart = document.querySelector('#bu_reset_game').getBoundingClientRect();
    const inspector = document.querySelector('#development-inspector').getBoundingClientRect();
    return restart.bottom > inspector.top && restart.top < inspector.bottom;
  });
  expect(overlap).toBe(false);
  expect(new URL(page.url()).hash).not.toBe(initialHash);
  const replayHistory = await page.evaluate(() => LZString.decompressFromEncodedURIComponent(location.hash.slice(1)).split(','));
  expect(replayHistory.filter(pageId => pageId === '2')).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('double activation cannot append a scripted destination twice', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await useFixture(page, 'Async navigation fixture', 'test-fixtures/async-navigation');
  await page.goto('/?dev');
  const selected = page.getByRole('button', { name: 'Inspect the machine' });

  await selected.evaluate(button => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  await expect(page.getByRole('heading', { name: 'Programmatic destination' })).toHaveCount(1);
  await expect(page.getByText('Continuation resumed with inspect.')).toHaveCount(1);
  const replayHistory = await page.evaluate(() => LZString.decompressFromEncodedURIComponent(location.hash.slice(1)).split(','));
  expect(replayHistory.filter(pageId => pageId === 'inspect')).toHaveLength(1);
  expect(replayHistory.filter(pageId => pageId === '2')).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

async function openSessionFixture(page) {
  await useFixture(page, 'Session history fixture', 'test-fixtures/session-history');
  await page.goto('/?dev');
  await expect(page.getByRole('heading', { name: 'Session history fixture' })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).not.toBe('');
}

async function chooseAndWaitForCheckpoint(page, text) {
  const previousUrl = page.url();
  await page.locator('.pagelink', { hasText: text }).click();
  await expect(page).not.toHaveURL(previousUrl);
}

test('reloading the initial session preserves its seed and entry effects', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openSessionFixture(page);
  const initialHash = new URL(page.url()).hash;
  const seededResult = await page.getByText(/Seeded result:/).textContent();

  await page.reload();

  await expect(page.getByText(seededResult)).toBeVisible();
  expect(new URL(page.url()).hash).toBe(initialHash);
  await expect(page.getByRole('heading', { name: 'Session history fixture' })).toHaveCount(1);
  await expect(page.getByText('Start entries: 1')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('browser Back restores the previous transcript, state, and graph route', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openSessionFixture(page);
  await chooseAndWaitForCheckpoint(page, 'Enter the middle passage');
  await expect(page.getByRole('heading', { name: 'Middle passage' })).toBeVisible();
  const middleUrl = page.url();
  await chooseAndWaitForCheckpoint(page, 'Take the later route');
  await expect(page.getByRole('heading', { name: 'Later passage' })).toBeVisible();

  await page.goBack();

  await expect(page).toHaveURL(middleUrl);
  await expect(page.getByRole('heading', { name: 'Later passage' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Middle passage' })).toHaveCount(1);
  await expect(page.getByText('Dynamic state: middle')).toHaveCount(1);
  await expect(page.locator('#state-container')).toContainText('route_state: middle');
  await expect(page.locator('#state-container')).not.toContainText('abandoned_only');
  await expect(page.locator('#node_2')).toHaveClass(/active/);
  await expect(page.locator('#node_3')).not.toHaveClass(/active/);
  expect(pageErrors).toEqual([]);
});

test('browser Forward restores the later transcript and state', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openSessionFixture(page);
  await chooseAndWaitForCheckpoint(page, 'Enter the middle passage');
  await chooseAndWaitForCheckpoint(page, 'Take the later route');
  await expect(page.getByRole('heading', { name: 'Later passage' })).toBeVisible();
  const laterUrl = page.url();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Later passage' })).toHaveCount(0);

  await page.goForward();

  await expect(page).toHaveURL(laterUrl);
  await expect(page.getByRole('heading', { name: 'Later passage' })).toHaveCount(1);
  await expect(page.getByText('Dynamic state: later')).toHaveCount(1);
  await expect(page.locator('#state-container')).toContainText('route_state: later');
  await expect(page.locator('#node_3')).toHaveClass(/active/);
  expect(pageErrors).toEqual([]);
});

test('scripted choice and goToPage create one stable browser checkpoint', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openSessionFixture(page);
  await chooseAndWaitForCheckpoint(page, 'Enter the middle passage');
  await chooseAndWaitForCheckpoint(page, 'Open the scripted console');
  await expect(page.getByRole('button', { name: 'Activate the console' })).toBeVisible();
  const promptUrl = page.url();
  await page.getByRole('button', { name: 'Activate the console' }).click();
  await expect(page).not.toHaveURL(promptUrl);
  await expect(page.getByRole('heading', { name: 'Session destination' })).toBeVisible();
  const finalUrl = page.url();

  await page.goBack();
  await expect(page).toHaveURL(promptUrl);
  await expect(page.getByRole('heading', { name: 'Session destination' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Activate the console' })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(finalUrl);
  await expect(page.getByRole('heading', { name: 'Session destination' })).toHaveCount(1);
  await expect(page.getByText('Console continuation: activate')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Activate the console' })).toHaveClass(/chosen/);
  expect(pageErrors).toEqual([]);
});

test('repeated Back and Forward cycles never duplicate restored content', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openSessionFixture(page);
  await chooseAndWaitForCheckpoint(page, 'Enter the middle passage');
  await chooseAndWaitForCheckpoint(page, 'Take the later route');
  const laterUrl = page.url();

  for (let cycle = 0; cycle < 2; cycle++) {
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Middle passage' })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Later passage' })).toHaveCount(0);
    await expect(page.getByText('Dynamic state: middle')).toHaveCount(1);
    await page.goForward();
    await expect(page).toHaveURL(laterUrl);
    await expect(page.getByRole('heading', { name: 'Later passage' })).toHaveCount(1);
    await expect(page.getByText('Dynamic state: later')).toHaveCount(1);
  }
  expect(pageErrors).toEqual([]);
});

test('abandoned scripted work cannot mutate a restored session', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openSessionFixture(page);
  await chooseAndWaitForCheckpoint(page, 'Enter the middle passage');
  const middleUrl = page.url();
  await chooseAndWaitForCheckpoint(page, 'Open the scripted console');
  const abandonedChoice = await page.getByRole('button', { name: 'Activate the console' }).elementHandle();

  await page.goBack();
  await expect(page).toHaveURL(middleUrl);
  await abandonedChoice.evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));

  await expect(page.getByText('Console continuation: activate')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Session destination' })).toHaveCount(0);
  await expect(page.locator('#state-container')).not.toContainText('console_answer');
  await expect(page).toHaveURL(middleUrl);
  expect(pageErrors).toEqual([]);
});

async function openErrorFixture(page) {
  await useFixture(page, 'Story error fixture', 'test-fixtures/story-errors');
  await page.goto('/?dev');
  await expect(page.getByRole('heading', { name: 'Story error fixture' })).toBeVisible();
}

test('a genuine missing page uses the generic development failure notice', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openErrorFixture(page);
  await page.locator('.pagelink', { hasText: 'Open a missing page' }).click();

  const error = page.locator('.story-error');
  await expect(error).toHaveText('This passage could not be completed.See Problems below for details.');
  await expect(error).not.toContainText(/Missing page|99|test-fixtures|Condition error|Expression error|Script error/i);
  expect(pageErrors).toEqual([]);
});

test('a synchronous script failure has page context and is not reported as missing', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openErrorFixture(page);
  await page.locator('.pagelink', { hasText: 'Open the runtime-error page' }).click();

  await expect(page.getByRole('heading', { name: 'Runtime-error passage' })).toHaveCount(0);
  await expect(page.getByText('Content after the broken script.')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Forbidden later choice' })).toHaveCount(0);
  await expect(page.locator('#state-container')).toContainText('original');
  await expect(page.locator('#state-container')).not.toContainText('mutated');
  const error = page.locator('.story-error');
  await expect(error).toHaveText('This passage could not be completed.See Problems below for details.');
  await expect(error).not.toContainText(/test-fixtures|line \d+/);
  await expect(error).not.toContainText('synchronous fixture failure');
  await expect(page.getByText(/page .*not found|Seite .*nicht gefunden/i)).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('a script syntax error is distinguished from a missing page', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openErrorFixture(page);
  await page.locator('.pagelink', { hasText: 'Open the syntax-error page' }).click();

  const error = page.locator('.story-error');
  await expect(error).toHaveText('This passage could not be completed.See Problems below for details.');
  await expect(error).not.toContainText(/test-fixtures|line \d+/);
  await expect(error).not.toContainText(/Unexpected token|SyntaxError/i);
  await expect(page.locator('#state-container')).toContainText('original');
  await expect(page.locator('#state-container')).not.toContainText('mutated');
  await expect(page.getByText(/page .*not found|Seite .*nicht gefunden/i)).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('game-mode passage failures expose no internals and request no analysis', async ({ page }) => {
  await useFixture(page, 'Story error fixture', 'test-fixtures/story-errors');
  let analysisRequests = 0;
  await page.route(/\/\.story-tools\/analysis\.json/, route => { analysisRequests += 1; return route.abort(); });
  await page.goto('/?mode=game');
  await page.locator('.pagelink', { hasText: 'Open the syntax-error page' }).click();
  const error = page.locator('.story-error');
  await expect(error).toHaveText('This part of the story could not be loaded.');
  await expect(error).not.toContainText(/pages|line|script|SyntaxError|Unexpected/i);
  expect(analysisRequests).toBe(0);
});

test('a broken condition atomically discards the passage and later content', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openErrorFixture(page);
  await page.locator('.pagelink', { hasText: 'Open the condition-error page' }).click();

  await expect(page.getByText('Valid false content must stay hidden.')).toHaveCount(0);
  await expect(page.getByText('Content after the broken condition.')).toHaveCount(0);
  const error = page.locator('.story-error');
  await expect(error).toHaveText('This passage could not be completed.See Problems below for details.');
  await expect(error).not.toContainText('missingCondition.value');
  await expect(error).not.toContainText(/undefined|null|ReferenceError|TypeError/i);
  await expect(error).not.toContainText(/test-fixtures|line \d+/);
  expect(pageErrors).toEqual([]);
});

test('a broken inline expression atomically discards earlier and later output', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openErrorFixture(page);
  await page.locator('.pagelink', { hasText: 'Open the expression-error page' }).click();

  await expect(page.getByText('Valid expression result: 5')).toHaveCount(0);
  await expect(page.getByText('Content after the broken expression.')).toHaveCount(0);
  const error = page.locator('.story-error');
  await expect(error).toHaveText('This passage could not be completed.See Problems below for details.');
  await expect(error).not.toContainText('missingInventory.key.name');
  await expect(error).not.toContainText(/test-fixtures|line \d+/);
  await expect(page.getByText(/page .*not found|Seite .*nicht gefunden/i)).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('an asynchronous script rejection uses the generic development notice', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openErrorFixture(page);
  await page.locator('.pagelink', { hasText: 'Open the async-error page' }).click();
  const beforeAnswer = page.url();
  await page.getByRole('button', { name: 'Continue the failing script' }).click();

  const error = page.locator('.story-error');
  await expect(error).toHaveText('This passage could not be completed.See Problems below for details.');
  await expect(error).not.toContainText(/test-fixtures|line \d+/);
  await expect(error).not.toContainText('asynchronous fixture failure');
  await expect(page.getByRole('heading', { name: 'Valid destination' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Async-error passage' })).toHaveCount(0);
  const replayHistory = await page.evaluate(() => LZString.decompressFromEncodedURIComponent(location.hash.slice(1)).split(','));
  expect(replayHistory.filter(token => token === 'continue')).toHaveLength(0);
  expect(new URL(page.url()).hash).not.toContain('continue');
  expect(pageErrors).toEqual([]);
});

test('valid scripts, conditions, expressions, and navigation remain unaffected', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openErrorFixture(page);
  await page.locator('.pagelink', { hasText: 'Open the valid page' }).click();

  await expect(page.getByText('Valid hidden content.')).toHaveCount(0);
  await expect(page.getByText('Valid condition content.')).toBeVisible();
  await expect(page.getByText('Valid expression: 14')).toBeVisible();
  await expect(page.locator('.story-error')).toHaveCount(0);
  await page.locator('.pagelink', { hasText: 'Continue normally' }).click();
  await expect(page.getByRole('heading', { name: 'Valid destination' })).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

async function openKeyboardFixture(page) {
  await useFixture(page, 'Keyboard accessibility fixture', 'test-fixtures/keyboard-accessibility');
  await page.goto('/?dev');
  await expect(page.getByRole('heading', { name: 'Keyboard fixture start' })).toBeVisible();
}

test('ordinary choices are keyboard-focusable semantic links', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openKeyboardFixture(page);

  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toHaveText('Take the primary route');
  await expect(focused).toHaveJSProperty('tagName', 'A');
  await expect(focused).toHaveAttribute('href', /2/);
  const focusStyle = await focused.evaluate(element => getComputedStyle(element).outlineStyle);
  expect(focusStyle).not.toBe('none');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'Keyboard destination' })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Keyboard fixture start' })).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test('rejected ordinary choices leave the tab order', async ({ page }) => {
  await openKeyboardFixture(page);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Keyboard destination' })).toBeVisible();

  const rejected = page.getByText('Take the rejected route');
  await expect(rejected).toHaveAttribute('tabindex', '-1');
  await expect(rejected).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('Open the scripted interaction');
  await rejected.press('Enter');
  await expect(page.getByRole('heading', { name: 'Rejected route A' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Keyboard destination' })).toHaveCount(1);
});

test('keyboard navigation focuses the newly appended passage', async ({ page }) => {
  await openKeyboardFixture(page);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');

  const destination = page.locator('.story-passage[data-page-id="2"]');
  await expect(destination).toBeFocused();
  await expect(destination).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('Open the scripted interaction');
});

test('pointer activation does not force focus to the new passage', async ({ page }) => {
  await openKeyboardFixture(page);
  const choice = page.getByText('Take the primary route');
  await choice.click();

  const destination = page.locator('.story-passage[data-page-id="2"]');
  await expect(destination).toBeVisible();
  await expect(destination).not.toBeFocused();
  await expect(choice).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Keyboard destination' })).toHaveCount(1);
});

test('development layout has only the transcript scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await openKeyboardFixture(page);
  await page.getByText('Take the primary route').click();

  const layout = await page.evaluate(() => ({
    htmlClientHeight: document.documentElement.clientHeight,
    htmlScrollHeight: document.documentElement.scrollHeight,
    bodyClientHeight: document.body.clientHeight,
    bodyScrollHeight: document.body.scrollHeight,
    gameOverflowY: getComputedStyle(document.querySelector('#game_pane')).overflowY,
  }));
  expect(layout.htmlScrollHeight).toBe(layout.htmlClientHeight);
  expect(layout.bodyScrollHeight).toBe(layout.bodyClientHeight);
  expect(layout.gameOverflowY).toBe('auto');
});

test('pointer choice scrolls the development transcript to the appended passage', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 420 });
  await useScrollFixture(page);
  await page.goto('/?dev');
  const before = await page.locator('#game_pane').evaluate(element => element.scrollTop);

  await page.getByText('Continue by ordinary choice').click();

  await expect(page.getByRole('heading', { name: 'Ordinary scroll destination' })).toHaveCount(1);
  await expect.poll(() => page.locator('#game_pane').evaluate(element => element.scrollTop)).toBeGreaterThan(before);
  await expect.poll(() => passageIsVisible(page, '2')).toBe(true);
  const layout = await page.evaluate(() => ({
    htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
    bodyScrollable: document.body.scrollHeight > document.body.clientHeight,
  }));
  expect(layout).toEqual({ htmlOverflowY: 'hidden', bodyScrollable: false });
});

test('normal playback scrolls only the body to the appended passage', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 420 });
  await useScrollFixture(page, { normalMode: true });
  await page.goto('/');
  const before = await page.evaluate(() => document.body.scrollTop);

  await page.getByText('Continue by ordinary choice').click();

  await expect(page.getByRole('heading', { name: 'Ordinary scroll destination' })).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.body.scrollTop)).toBeGreaterThan(before);
  await expect.poll(() => passageIsVisible(page, '2')).toBe(true);
  const layout = await page.evaluate(() => ({
    htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
    bodyOverflowY: getComputedStyle(document.body).overflowY,
    bodyScrollable: document.body.scrollHeight > document.body.clientHeight,
    gameOverflowY: getComputedStyle(document.querySelector('#game_pane')).overflowY,
    gameScrollable: document.querySelector('#game_pane').scrollHeight > document.querySelector('#game_pane').clientHeight,
  }));
  expect(layout).toEqual({
    htmlOverflowY: 'hidden',
    bodyOverflowY: 'auto', bodyScrollable: true,
    gameOverflowY: 'visible', gameScrollable: false,
  });
});

test('keyboard choice focuses and scrolls to the appended passage', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 420 });
  await useScrollFixture(page);
  await page.goto('/?dev');
  await expect(page.getByRole('heading', { name: 'Scroll fixture start' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('Continue by ordinary choice');
  await page.keyboard.press('Enter');

  const destination = page.locator('.story-passage[data-page-id="2"]');
  await expect(destination).toBeFocused();
  expect(await passageIsVisible(page, '2')).toBe(true);
  await expect(page.getByText('Rejected choice')).toHaveAttribute('tabindex', '-1');
});

test('scripted choice and goToPage scroll to one settled destination', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 420 });
  await useScrollFixture(page);
  await page.goto('/?dev');
  await page.getByText('Continue by ordinary choice').click();
  await page.getByText('Open scripted choice').click();
  const before = await page.locator('#game_pane').evaluate(element => element.scrollTop);
  await page.getByRole('button', { name: 'Accept scripted choice' }).click();

  await expect(page.getByText('Settled scripted output: accept')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Programmatic scroll destination' })).toHaveCount(1);
  await expect.poll(() => page.locator('#game_pane').evaluate(element => element.scrollTop)).toBeGreaterThan(before);
  await expect.poll(() => passageIsVisible(page, '5')).toBe(true);
  const replayHistory = await page.evaluate(() => LZString.decompressFromEncodedURIComponent(location.hash.slice(1)).split(','));
  expect(replayHistory.filter(token => token === 'accept')).toHaveLength(1);
  expect(replayHistory.filter(token => token === '5')).toHaveLength(1);
});

test('reduced motion scroll settles immediately at the appended passage', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 420 });
  await useScrollFixture(page);
  await page.goto('/?dev');
  await page.getByText('Continue by ordinary choice').click();

  await expect(page.getByRole('heading', { name: 'Ordinary scroll destination' })).toHaveCount(1);
  expect(await passageIsVisible(page, '2')).toBe(true);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
});

test('scripted choices retain native button keyboard behavior', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openKeyboardFixture(page);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Keyboard destination' })).toBeVisible();
  await expect(page.locator('.story-passage[data-page-id="2"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Scripted choice passage' })).toBeVisible();
  await expect(page.locator('.story-passage[data-page-id="3"]')).toBeFocused();
  await page.keyboard.press('Tab');

  const selected = page.getByRole('button', { name: 'Accept the temporary choice' });
  const rejected = page.getByRole('button', { name: 'Reject the temporary choice' });
  await expect(selected).toBeFocused();
  await expect(rejected).toHaveJSProperty('tagName', 'BUTTON');
  await page.keyboard.press('Space');

  await expect(page.getByText('Keyboard continuation: accept')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Keyboard programmatic destination' })).toHaveCount(1);
  await expect(rejected).toBeDisabled();
  const replayHistory = await page.evaluate(() => LZString.decompressFromEncodedURIComponent(location.hash.slice(1)).split(','));
  expect(replayHistory.filter(token => token === 'accept')).toHaveLength(1);
  expect(replayHistory.filter(token => token === '6')).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('the polite status announces only the stable current passage', async ({ page }) => {
  await openKeyboardFixture(page);
  const status = page.locator('#story-status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await page.getByText('Take the primary route').click();
  await expect(status).toHaveText('New passage: Keyboard destination');
  expect((await status.textContent()).length).toBeLessThan(80);
  const destinationUrl = page.url();
  await page.getByText('Open the scripted interaction').click();
  await expect(status).toHaveText('New passage: Scripted choice passage');
  await page.goBack();
  await expect(page).toHaveURL(destinationUrl);
  await expect(status).toHaveText('Current passage: Keyboard destination');
});

test('reduced motion disables story transitions and smooth scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openKeyboardFixture(page);
  const rejected = page.getByText('Take the rejected route');
  const transitionDuration = await rejected.evaluate(element => getComputedStyle(element).transitionDuration);
  expect(transitionDuration.split(',').every(duration => duration.trim() === '0s')).toBe(true);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');

  await page.getByText('Take the primary route').click();
  await expect(rejected).toHaveClass(/dismissed/);
  await expect(page.getByRole('heading', { name: 'Keyboard destination' })).toHaveCount(1);
});
