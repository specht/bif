import { expect, test } from '@playwright/test';

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error));
  return errors;
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
  await page.route(/\/config\.js\?.*/, route => route.fulfill({
    contentType: 'text/javascript',
    body: 'export const title = "Rewind state fixture"; export const path = "test-fixtures/rewind-state";',
  }));

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
