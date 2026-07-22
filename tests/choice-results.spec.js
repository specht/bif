import { expect, test } from '@playwright/test';

async function openFixture(page, mode = 'game') {
  await page.route(/\/config\.js\?.*/, route => route.fulfill({
    contentType: 'text/javascript',
    body: "export const path = 'test-fixtures/choice-results/pages';",
  }));
  await page.goto(`/?mode=${mode}`);
}

test('local choice reveals and freezes its result without reentering the page', async ({ page }) => {
  await openFixture(page);
  await expect(page.getByText('Every Thursday')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ask the follow-up.' })).toHaveCount(0);
  const choice = page.getByRole('button', { name: 'Ask whether he travels often.' });
  await choice.click();
  await expect(page.getByText(/Every Thursday.*Result 1/)).toBeVisible();
  await expect(page.getByText('Page entries: 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask the follow-up.' })).toBeVisible();
  await expect(page.locator('.story-passage')).toHaveCount(1);
  await expect(choice).toHaveAttribute('aria-disabled', 'true');
  await expect(choice).toHaveAttribute('tabindex', '-1');
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.live-choice-set')).toHaveCount(1);
  await expect(page.locator('.committed-choice-turn')).toHaveCount(1);
});

test('page and local choices share one canonical live set and computed style', async ({ page }) => {
  await openFixture(page);
  const local = page.getByRole('button', { name: 'Ask whether he travels often.' });
  const pageChoice = page.getByRole('link', { name: 'Leave without a result.' });
  await expect(page.locator('.live-choice-set')).toHaveCount(1);
  const styles = await Promise.all([local, pageChoice].map(control => control.evaluate(element => {
    const style = getComputedStyle(element);
    const item = element.closest('li');
    return {
      fontSize: style.fontSize, lineHeight: style.lineHeight, padding: style.padding,
      borderWidth: style.borderWidth, borderRadius: style.borderRadius,
      height: element.getBoundingClientRect().height,
      width: element.getBoundingClientRect().width,
      marker: item ? getComputedStyle(item).listStyleType : null,
    };
  })));
  expect(styles[0]).toEqual(styles[1]);
  expect(styles[0].marker).toBe('none');
  const spacing = await page.locator('.live-choice-set').evaluate(set => {
    const items = [...set.children];
    const gaps = items.slice(1).map((item, index) => item.getBoundingClientRect().top - items[index].getBoundingClientRect().bottom);
    return {
      gap: getComputedStyle(set).gap,
      gaps,
      margins: [...set.querySelectorAll('.story-choice')].map(control => getComputedStyle(control).marginBlock),
      itemMargins: items.map(item => getComputedStyle(item).marginBlock),
    };
  });
  expect(spacing.gaps.every(gap => Math.abs(gap - spacing.gaps[0]) <= 1)).toBe(true);
  expect(spacing.margins.every(margin => margin === '0px')).toBe(true);
  expect(spacing.itemMargins.every(margin => margin === '0px')).toBe(true);
});

test('mixed page and loose local choices use direct controls with one measured gap', async ({ page }) => {
  await page.goto('/?mode=game');
  const labels = [
    'Du schickst zwei Männer vor, um die Höhle auszukundschaften.',
    'Du untersuchst zunächst den Höhleneingang.',
    'Du gehst direkt in die Höhle.',
    'Ask whether he travels this route often.',
    'Ask whether he saw the suitcase.',
  ];
  const result = await page.locator('.live-choice-set').evaluate((set, expectedLabels) => {
    const items = [...set.children].filter(item => expectedLabels.includes(item.textContent.trim()));
    const controls = items.map(item => item.querySelector(':scope > .story-choice'));
    const gaps = items.slice(1).map((item, index) =>
      item.getBoundingClientRect().top - items[index].getBoundingClientRect().bottom);
    return {
      directControls: controls.map(Boolean),
      paragraphControls: items.map(item => item.querySelector(':scope > p > .story-choice') !== null),
      resultInsideControls: controls.map(control => /Every Thursday|carried it toward/.test(control?.textContent || '')),
      controlMargins: controls.map(control => getComputedStyle(control).marginBlock),
      itemMargins: items.map(item => getComputedStyle(item).marginBlock),
      markers: items.map(item => getComputedStyle(item).listStyleType),
      cssGap: Number.parseFloat(getComputedStyle(set).rowGap),
      gaps,
    };
  }, labels);
  expect(result.directControls).toEqual(Array(5).fill(true));
  expect(result.paragraphControls).toEqual(Array(5).fill(false));
  expect(result.resultInsideControls).toEqual(Array(5).fill(false));
  expect(result.controlMargins).toEqual(Array(5).fill('0px'));
  expect(result.itemMargins).toEqual(Array(5).fill('0px'));
  expect(result.markers).toEqual(Array(5).fill('none'));
  expect(result.gaps).toHaveLength(4);
  expect(result.gaps.every(gap => Math.abs(gap - result.cssGap) <= 1)).toBe(true);
});

test('ordinary loose Markdown list paragraphs remain intact', async ({ page }) => {
  await page.route(/\/config\.js\?.*/, route => route.fulfill({
    contentType: 'text/javascript', body: "export const path = 'test-fixtures/loose-list-choice';",
  }));
  await page.route(/\/test-fixtures\/loose-list-choice\/1\.md\?.*/, route => route.fulfill({
    contentType: 'text/markdown',
    body: `# Loose lists\n\n- Ordinary prose before nested content.\n\n    A second ordinary paragraph.\n\n- [Ask locally.](.)\n\n    Result paragraph.\n\n    ![Result image](result.png)\n\n    - Nested result item`,
  }));
  await page.goto('/?mode=game');
  const structure = await page.locator('.story-passage').evaluate(passage => ({
    ordinaryParagraphs: passage.querySelectorAll('li:not([data-bif-choice-id]) > p').length,
    directChoice: Boolean(passage.querySelector('[data-bif-choice-id] > .story-choice')),
    wrappedChoice: Boolean(passage.querySelector('[data-bif-choice-id] > p > .story-choice')),
  }));
  expect(structure).toEqual({ ordinaryParagraphs: 2, directChoice: true, wrappedChoice: false });
  await page.getByRole('button', { name: 'Ask locally.' }).click();
  const result = page.locator('.choice-result');
  await expect(result.getByText('Result paragraph.', { exact: true })).toBeVisible();
  await expect(result.locator('img')).toHaveAttribute('alt', 'Result image');
  await expect(result.locator('li')).toContainText('Nested result item');
});

test('local turns scroll only the transcript container after commit', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 360 });
  await openFixture(page, 'dev');
  await page.locator('#game_pane').evaluate(element => { element.scrollTop = 0; });
  const graphScroll = await page.locator('#graph-container').evaluate(element => element.scrollTop);
  await page.getByRole('button', { name: 'Ask whether he travels often.' }).click();
  await expect(page.locator('.committed-choice-turn')).toHaveCount(1);
  await expect.poll(() => page.locator('#game_pane').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.locator('#graph-container').evaluate(element => element.scrollTop)).toBe(graphScroll);
  await expect(page.locator('.committed-choice-turn .story-choice')).toHaveAttribute('tabindex', '-1');
});

test('local scroll target is finite, clamped, and distinguishes short and tall turns', async ({ page }) => {
  await page.goto('/?mode=game');
  const result = await page.evaluate(async () => {
    const { localTurnScrollTarget } = await import('/lib/browser-story-scroll.js');
    return {
      visible: localTurnScrollTarget({ scrollTop: 100, clientHeight: 400, scrollHeight: 1000, turnTop: 150, turnBottom: 250, liveBottom: 450 }),
      short: localTurnScrollTarget({ scrollTop: 0, clientHeight: 400, scrollHeight: 1000, turnTop: 500, turnBottom: 600, liveBottom: 750 }),
      tall: localTurnScrollTarget({ scrollTop: 0, clientHeight: 400, scrollHeight: 1000, turnTop: 500, turnBottom: 950, liveBottom: 980 }),
      clamped: localTurnScrollTarget({ scrollTop: 0, clientHeight: 400, scrollHeight: 600, turnTop: 900, turnBottom: 1000 }),
      invalid: localTurnScrollTarget({ scrollTop: 0, clientHeight: 0, scrollHeight: 600, turnTop: 1, turnBottom: 2 }),
    };
  });
  expect(result).toEqual({ visible: null, short: 350, tall: 480, clamped: 200, invalid: null });
});

test('a tall local answer anchors its committed turn instead of skipping to the end', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 360 });
  await page.route(/\/config\.js\?.*/, route => route.fulfill({
    contentType: 'text/javascript', body: "export const path = 'test-fixtures/local-scroll';",
  }));
  const longAnswer = Array.from({ length: 18 }, (_, index) => `Answer paragraph ${index + 1}.`).join('\n\n');
  await page.route(/\/test-fixtures\/local-scroll\/1\.md\?.*/, route => route.fulfill({
    contentType: 'text/markdown',
    body: `# Long local answer\n\nIntroductory text.\n\n- [Ask for the long account.](.)\n\n    ${longAnswer.replaceAll('\n', '\n    ')}\n\n- [Continue listening.](.)\n\n    A short response.`,
  }));
  await page.goto('/?mode=dev');
  await page.getByRole('button', { name: 'Ask for the long account.' }).click();
  await expect.poll(() => page.evaluate(() => {
    const scroller = document.querySelector('#game_pane').getBoundingClientRect();
    const turn = document.querySelector('.committed-choice-turn').getBoundingClientRect();
    return Math.round(turn.top - scroller.top);
  })).toBeLessThanOrEqual(30);
  const bounds = await page.evaluate(() => {
    const scroller = document.querySelector('#game_pane').getBoundingClientRect();
    const turn = document.querySelector('.committed-choice-turn').getBoundingClientRect();
    const live = document.querySelector('.live-choice-set').getBoundingClientRect();
    return { turnInset: turn.top - scroller.top, liveBelow: live.bottom > scroller.bottom };
  });
  expect(bounds.turnInset).toBeGreaterThanOrEqual(0);
  expect(bounds.turnInset).toBeLessThanOrEqual(30);
  expect(bounds.liveBelow).toBe(true);
});

test('reduced motion uses an immediate transcript-container scroll', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.__storyScrollCalls = [];
    const original = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function (options) {
      if (this.id === 'game_pane') window.__storyScrollCalls.push({ ...options });
      return original.call(this, options);
    };
  });
  await page.setViewportSize({ width: 900, height: 360 });
  await openFixture(page, 'dev');
  await page.evaluate(() => { window.__storyScrollCalls = []; });
  await page.getByRole('button', { name: 'Ask whether he travels often.' }).click();
  await expect.poll(() => page.evaluate(() => window.__storyScrollCalls.length)).toBeGreaterThan(0);
  const call = await page.evaluate(() => window.__storyScrollCalls.at(-1));
  expect(call.behavior).toBe('auto');
  expect(Number.isFinite(call.top)).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('local turns commit chronologically above one reevaluated live set', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'Ask whether he travels often.' }).click();
  await page.getByRole('button', { name: 'Ask the follow-up.' }).click();
  const turns = page.locator('.committed-choice-turn');
  await expect(turns).toHaveCount(2);
  await expect(turns.nth(0)).toContainText('Ask whether he travels often.');
  await expect(turns.nth(0)).toContainText('Every Thursday');
  await expect(turns.nth(1)).toContainText('Ask the follow-up.');
  await expect(turns.nth(1)).toContainText('Grey coat and red gloves');
  await expect(page.locator('.live-choice-set')).toHaveCount(1);
  await expect(page.locator('.live-choice-set').getByText('Ask whether he travels often.')).toHaveCount(0);
  await expect(page.locator('.live-choice-set').getByText('Ask the follow-up.')).toHaveCount(0);
  expect(await page.locator('.story-passage').evaluate(passage => {
    const live = passage.querySelector('.live-choice-set');
    return [...passage.querySelectorAll('.committed-choice-turn')]
      .every(turn => Boolean(turn.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
});

test('local results replay once after reload', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'Ask whether he travels often.' }).click();
  const savedUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(savedUrl);
  await expect(page.getByText(/Every Thursday.*Result 1/)).toHaveCount(1);
  await expect(page.getByText('Page entries: 1')).toBeVisible();
  await expect(page.locator('.committed-choice-turn')).toHaveCount(1);
  await expect(page.locator('.live-choice-set')).toHaveCount(1);
});

test('history rewind restores chronological local checkpoints', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'Ask whether he travels often.' }).click();
  await expect.poll(() => page.url()).toContain('#');
  const firstUrl = page.url();
  await page.getByRole('button', { name: 'Ask the follow-up.' }).click();
  await expect.poll(() => page.url()).not.toBe(firstUrl);
  await page.goBack();
  await expect(page.locator('.committed-choice-turn')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Ask the follow-up.' })).toBeVisible();
  await page.goBack();
  await expect(page.locator('.committed-choice-turn')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ask whether he travels often.' })).toBeVisible();
  await expect(page.locator('.live-choice-set')).toHaveCount(1);
});

test('page choice processes its result before appending the target', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('link', { name: 'Give Adler the key.' }).click();
  await expect(page.getByRole('heading', { name: 'Adler has the key' })).toBeVisible();
  await expect(page.getByText('Target sees key: true')).toBeVisible();
  await expect(page.getByText('You give Adler the key.')).toBeVisible();
  await expect(page.locator('.story-passage')).toHaveCount(2);
});

test('page navigation after dialogue preserves committed turns and retires the live set', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'Ask whether he travels often.' }).click();
  await page.getByRole('link', { name: 'Give Adler the key.' }).click();
  const source = page.locator('.story-passage').first();
  await expect(source.locator('.committed-choice-turn')).toHaveCount(2);
  await expect(source.locator('.live-choice-set')).toHaveCount(0);
  await expect(source.getByText('Every Thursday')).toHaveCount(1);
  await expect(source.getByText('You give Adler the key.')).toHaveCount(1);
  await expect(page.getByText('Target sees key: true')).toBeVisible();
});

test('local choices in game mode do not request analysis', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (request.url().includes('analysis.json')) requests.push(request.url()); });
  await openFixture(page, 'game');
  await page.getByRole('button', { name: 'Ask whether he travels often.' }).press('Enter');
  await expect(page.getByText(/Every Thursday/)).toBeVisible();
  expect(requests).toEqual([]);
});
