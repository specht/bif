import { expect, test } from '@playwright/test';

async function openChoiceFixture(page, mode = 'game') {
  await page.route(/\/config\.js\?.*/, route => route.fulfill({
    contentType: 'text/javascript', body: "export const path = 'test-fixtures/choice-results/pages';",
  }));
  await page.goto(`/?mode=${mode}`);
}

test('semantic planner keeps structural blocks whole and splits only plain long prose', async ({ page }) => {
  await page.goto('/?mode=game');
  const result = await page.evaluate(async () => {
    const reveal = await import('/lib/browser-story-reveal.js');
    const root = document.createElement('section');
    root.innerHTML = `<h2>Heading</h2>
      <p>Short sentence. Second sentence.</p>
      <p class="long">This is the first substantial sentence in a deliberately long paragraph. This is the second substantial sentence, which remains grouped with it. This is the third substantial sentence. This is the fourth substantial sentence.</p>
      <p class="rich">A <strong>rich sentence.</strong> Another sentence. A third sentence that must not damage markup.</p>
      <blockquote><p>A short quotation.</p></blockquote>
      <ul class="ordinary"><li>One</li><li>Two</li></ul><table><tbody><tr><td>Cell</td></tr></tbody></table>
      <figure><img alt="Example"></figure><pre><code>const value = 1;</code></pre><custom-story-block>Custom</custom-story-block>
      <ul class="live-choice-set"><li><button class="story-choice">Continue</button></li></ul>`;
    document.body.append(root);
    const units = reveal.planPageReveal(root, { locale: 'de' });
    const fallback = reveal.sentenceSegments('Dr. Adler wartet. Dann geht er.', 'de', null);
    const abbreviation = reveal.sentenceSegments('Dr. Adler wartet. Dann geht er.', 'de');
    return {
      tags: units.map(unit => unit.className || unit.tagName),
      last: units.at(-1).className,
      longGroups: root.querySelectorAll('.long > .story-reveal-prose-group').length,
      richHtml: root.querySelector('.rich').innerHTML,
      shortWhole: units.includes(root.querySelector('p:not(.long):not(.rich)')),
      quoteWhole: units.includes(root.querySelector('blockquote')),
      listWhole: units.includes(root.querySelector('.ordinary')),
      tableWhole: units.includes(root.querySelector('table')),
      figureWhole: units.includes(root.querySelector('figure')),
      codeWhole: units.includes(root.querySelector('pre')),
      customWhole: units.includes(root.querySelector('custom-story-block')),
      empty: units.some(unit => !unit.textContent.trim() && !unit.matches('img, figure, hr')),
      fallback,
      abbreviation,
    };
  });
  expect(result.last).toBe('live-choice-set');
  expect(result.longGroups).toBe(2);
  expect(result.richHtml).toContain('<strong>rich sentence.</strong>');
  expect(result).toMatchObject({ shortWhole: true, quoteWhole: true, listWhole: true, tableWhole: true, figureWhole: true, codeWhole: true, customWhole: true, empty: false });
  expect(result.fallback).toEqual(['Dr. Adler wartet. Dann geht er.']);
  expect(result.abbreviation).toEqual(['Dr. Adler wartet. ', 'Dann geht er.']);
});

test('local reveal commits logic first, orders units, gates choices, and click skips safely', async ({ page }) => {
  await openChoiceFixture(page);
  await page.getByRole('button', { name: 'Ask whether he travels often.' }).click();
  await expect(page.locator('.committed-choice-turn')).toHaveCount(1);
  await expect(page.getByText('Page entries: 1')).toBeVisible();
  await expect(page.locator('#state-container')).toContainText('result_count: 1');
  const pending = page.locator('[data-reveal-state="pending"]');
  await expect(pending).not.toHaveCount(0);
  const live = page.locator('.live-choice-set');
  await expect(live).toHaveAttribute('inert', '');
  const order = await page.locator('.committed-choice-turn, .live-choice-set').evaluateAll(elements => elements.map(element => ({
    className: element.className,
    choiceState: element.querySelector('.story-choice')?.dataset.revealState,
    liveState: element.matches('.live-choice-set') ? element.dataset.revealState : null,
  })));
  expect(order[0].choiceState).toBeTruthy();
  expect(order.at(-1).className).toContain('live-choice-set');
  await page.locator('#game_pane').click({ position: { x: 20, y: 20 } });
  await expect(pending).toHaveCount(0);
  await expect(live).not.toHaveAttribute('inert', '');
  await expect(page.locator('.story-passage')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ask the follow-up.' }).click();
  await expect(page.locator('.committed-choice-turn')).toHaveCount(2);
  await expect(page.getByText('Grey coat and red gloves')).toHaveCount(1);
});

test('keyboard skip is consumed and reduced motion reveals immediately', async ({ page }) => {
  await openChoiceFixture(page);
  await page.getByRole('button', { name: 'Ask whether he travels often.' }).click();
  await expect(page.locator('[data-reveal-state="pending"]')).not.toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-reveal-state="pending"]')).toHaveCount(0);
  await expect(page.locator('.story-passage')).toHaveCount(1);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?mode=game');
  await page.getByRole('button', { name: 'Ask whether he travels often.' }).click();
  await expect(page.locator('[data-reveal-state="pending"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ask the follow-up.' })).toBeVisible();
});

test('new page commits before reveal, preserves prior transcript, and restores immediately', async ({ page }) => {
  await page.route(/\/config\.js\?.*/, route => route.fulfill({
    contentType: 'text/javascript', body: "export const path = 'test-fixtures/progressive-page';",
  }));
  await page.route(/\/test-fixtures\/progressive-page\/1\.md\?.*/, route => route.fulfill({
    contentType: 'text/markdown', body: '# Before\n\nPrevious transcript text.\n\n- [Open the new page.](2)',
  }));
  await page.route(/\/test-fixtures\/progressive-page\/2\.md\?.*/, route => route.fulfill({
    contentType: 'text/markdown', body: `# Newly committed page\n\n<script>page_reveal_state = 'committed';</script>\n\nFirst new paragraph.\n\nSecond new paragraph.\n\n- [Continue from the revealed page.](3)`,
  }));
  await page.route(/\/test-fixtures\/progressive-page\/3\.md\?.*/, route => route.fulfill({
    contentType: 'text/markdown', body: '# Should not open during skip',
  }));
  await page.goto('/?mode=game');
  await page.getByRole('link', { name: 'Open the new page.' }).click();
  await expect(page.getByText('Previous transcript text.')).toBeVisible();
  await expect(page.locator('#state-container')).toContainText('page_reveal_state: committed');
  const target = page.locator('.story-passage[data-page-id="2"]');
  await expect(target.locator('[data-reveal-state="pending"]')).not.toHaveCount(0);
  const live = target.locator('.live-choice-set');
  await expect(live).toHaveAttribute('inert', '');
  expect(await target.locator(':scope > [data-reveal-state]').evaluateAll(units => units.map(unit => unit.className).at(-1))).toContain('live-choice-set');
  await page.locator('#game_pane').click({ position: { x: 10, y: 10 } });
  await expect(target.locator('[data-reveal-state="pending"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Should not open during skip' })).toHaveCount(0);
  await expect(live).not.toHaveAttribute('inert', '');
  const saved = page.url();
  await page.reload();
  await expect(page).toHaveURL(saved);
  await expect(page.locator('[data-reveal-state="pending"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Newly committed page' })).toBeVisible();
});
