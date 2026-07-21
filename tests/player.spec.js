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
