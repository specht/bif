import { expect, test } from '@playwright/test';

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error));
  return errors;
}

async function useFixture(page, title, path) {
  await page.route(/\/config\.js\?.*/, route => route.fulfill({
    contentType: 'text/javascript',
    body: `export const title = ${JSON.stringify(title)}; export const path = ${JSON.stringify(path)};`,
  }));
}

test('initial page renders', async ({ page }) => {
  const pageErrors = collectPageErrors(page);

  await page.goto('/');

  await expect(page).toHaveTitle('Die List des Odysseus');
  await expect(page.getByText('Du bist Odysseus', { exact: false })).toBeVisible();
  await expect(page.getByText('Du gehst mit', { exact: false })).toBeVisible();
  await expect(page.locator('.pagelink')).not.toHaveCount(0);
  expect(pageErrors).toEqual([]);
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
  await expect(page.getByRole('button', { name: 'Spiel neu starten' })).toHaveCount(1);
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

test('a genuine missing page is reported as missing', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openErrorFixture(page);
  await page.locator('.pagelink', { hasText: 'Open a missing page' }).click();

  const error = page.locator('.story-error');
  await expect(error).toContainText(/Missing page/i);
  await expect(error).toContainText(/99|test-fixtures\/story-errors\/99\.md/);
  await expect(error).not.toContainText(/Condition error|Expression error|Script error/i);
  expect(pageErrors).toEqual([]);
});

test('a synchronous script failure has page context and is not reported as missing', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openErrorFixture(page);
  await page.locator('.pagelink', { hasText: 'Open the runtime-error page' }).click();

  await expect(page.getByRole('heading', { name: 'Runtime-error passage' })).toHaveCount(1);
  await expect(page.getByText('Content after the broken script.')).toHaveCount(1);
  const error = page.locator('.story-error');
  await expect(error).toContainText(/Script error/i);
  await expect(error).toContainText('test-fixtures/story-errors/2.md');
  await expect(error).toContainText(/line \d+/);
  await expect(error).toContainText('synchronous fixture failure');
  await expect(page.getByText(/page .*not found|Seite .*nicht gefunden/i)).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('a script syntax error is distinguished from a missing page', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openErrorFixture(page);
  await page.locator('.pagelink', { hasText: 'Open the syntax-error page' }).click();

  const error = page.locator('.story-error');
  await expect(error).toContainText(/Script syntax error/i);
  await expect(error).toContainText('test-fixtures/story-errors/3.md');
  await expect(error).toContainText(/Unexpected token|SyntaxError/i);
  await expect(page.getByText(/page .*not found|Seite .*nicht gefunden/i)).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('a broken condition is visible while valid false remains silent', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openErrorFixture(page);
  await page.locator('.pagelink', { hasText: 'Open the condition-error page' }).click();

  await expect(page.getByText('Valid false content must stay hidden.')).toHaveCount(0);
  await expect(page.getByText('Content after the broken condition.')).toBeVisible();
  const error = page.locator('.story-error');
  await expect(error).toContainText(/Condition error/i);
  await expect(error).toContainText('missingCondition.value');
  await expect(error).toContainText(/undefined|null|ReferenceError|TypeError/i);
  await expect(error).toContainText('test-fixtures/story-errors/4.md');
  await expect(error).toContainText(/line \d+/);
  expect(pageErrors).toEqual([]);
});

test('a broken inline expression reports its source and allows later content', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openErrorFixture(page);
  await page.locator('.pagelink', { hasText: 'Open the expression-error page' }).click();

  await expect(page.getByText('Valid expression result: 5')).toBeVisible();
  await expect(page.getByText('Content after the broken expression.')).toBeVisible();
  const error = page.locator('.story-error');
  await expect(error).toContainText(/Expression error/i);
  await expect(error).toContainText('missingInventory.key.name');
  await expect(error).toContainText('test-fixtures/story-errors/5.md');
  await expect(error).toContainText(/line \d+/);
  await expect(page.getByText(/page .*not found|Seite .*nicht gefunden/i)).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('an asynchronous script rejection retains page context', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openErrorFixture(page);
  await page.locator('.pagelink', { hasText: 'Open the async-error page' }).click();
  const beforeAnswer = page.url();
  await page.getByRole('button', { name: 'Continue the failing script' }).click();

  const error = page.locator('.story-error');
  await expect(error).toContainText(/Async script error/i);
  await expect(error).toContainText('test-fixtures/story-errors/6.md');
  await expect(error).toContainText('asynchronous fixture failure');
  await expect(page.getByRole('heading', { name: 'Valid destination' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Async-error passage' })).toHaveCount(1);
  const replayHistory = await page.evaluate(() => LZString.decompressFromEncodedURIComponent(location.hash.slice(1)).split(','));
  expect(replayHistory.filter(token => token === 'continue')).toHaveLength(1);
  expect(page.url()).not.toBe(beforeAnswer);
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
