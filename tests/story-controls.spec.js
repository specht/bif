import { expect, test } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const root = process.cwd();

async function useStory(page, storyPath = 'test-fixtures/player-basic/pages') {
  await page.route(/\/config\.js(?:\?.*)?$/, route => route.fulfill({
    contentType: 'text/javascript', body: `export const path = '${storyPath}';`,
  }));
}

async function holdButton(page, button, duration = 975) {
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(duration);
  await page.mouse.up();
}

test('compact controls are accessible chrome outside the transcript in both local views', async ({ page }) => {
  await useStory(page);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/?mode=game');
  const toolbar = page.getByLabel('Story controls');
  const restart = page.locator('.story-restart-control');
  const authoring = page.getByRole('button', { name: 'Open authoring view' });
  await expect(restart).toHaveAttribute('title', 'Hold to restart story');
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
  await expect(page.getByRole('button', { name: 'Hold to restart story' })).toBeVisible();
  const game = page.getByRole('button', { name: 'Open game view' });
  await expect(game).toHaveAttribute('title', 'Open game view');
  await expect(game).toHaveText('');
  expect(await page.locator('.story-controls').evaluate(element => element.closest('#game_pane') !== null)).toBe(true);
});

test('toolbar keeps an opaque theme surface and fully opaque icons over story content', async ({ page }) => {
  await useStory(page);
  await page.goto('/?mode=game');
  await expect(page.locator('.story-controls .icon').first()).toBeVisible();
  const overlapsDarkImage = await page.evaluate(() => {
    const image = document.createElement('img');
    image.alt = '';
    image.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="120"%3E%3Crect width="100%25" height="100%25" fill="%23000"/%3E%3C/svg%3E';
    image.style.cssText = 'display:block;width:100%;height:120px;object-fit:cover';
    document.querySelector('#content').prepend(image);
    const controls = document.querySelector('.story-controls').getBoundingClientRect();
    const artwork = image.getBoundingClientRect();
    return controls.bottom > artwork.top && controls.top < artwork.bottom;
  });
  expect(overlapsDarkImage).toBe(true);
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    const styles = await page.locator('.story-controls').evaluate(element => {
      const toolbar = getComputedStyle(element);
      const icon = getComputedStyle(element.querySelector('.icon'));
      const button = getComputedStyle(element.querySelector('.story-icon-button'));
      return {
        background: toolbar.backgroundColor,
        surface: getComputedStyle(document.documentElement).getPropertyValue('--surface-1').trim(),
        opacity: toolbar.opacity,
        border: toolbar.borderTopWidth,
        shadow: toolbar.boxShadow,
        iconOpacity: icon.opacity,
        iconColor: icon.color,
        buttonColor: button.color,
      };
    });
    expect(styles.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(styles.opacity).toBe('1');
    expect(styles.border).not.toBe('0px');
    expect(styles.shadow).not.toBe('none');
    expect(styles.iconOpacity).toBe('1');
    expect(styles.iconColor).toBe(styles.buttonColor);
  }
});

test('reduced motion retains a visible time-based hold state', async ({ page }) => {
  await useStory(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?mode=game');
  await page.getByRole('link', { name: 'Take the direct route.' }).click();
  const restart = page.locator('.story-restart-control');
  await restart.dispatchEvent('pointerdown', { pointerId: 11, button: 0, isPrimary: true });
  await expect(restart).toHaveClass(/is-holding/);
  expect(await restart.evaluate(element => getComputedStyle(element, '::after').borderTopWidth)).not.toBe('0px');
  await restart.dispatchEvent('pointercancel', { pointerId: 11, button: 0, isPrimary: true });
});

test('restart before progress uses a simple activation and never duplicates controls', async ({ page }) => {
  await useStory(page);
  await page.addInitScript(() => { Object.defineProperty(window, 'confirm', { value: () => { throw new Error('native confirmation must not run'); } }); });
  await page.goto('/?mode=game');
  await page.getByRole('button', { name: 'Hold to restart story' }).click();
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
  await page.getByRole('button', { name: 'Hold to restart story' }).click();
  await expect(page.locator('.story-controls')).toHaveCount(1);
  await expect(page.locator('.story-restart-control')).toHaveCount(1);
  await expect(page.locator('#content .story-restart-control, #content .story-play-again')).toHaveCount(0);
});

test('progress restart requires a hold; release, pointer cancel, leaving, and Escape cancel cleanly', async ({ page }) => {
  await useStory(page);
  await page.addInitScript(() => { Object.defineProperty(window, 'confirm', { value: () => { throw new Error('native confirmation must not run'); } }); });
  await page.goto('/?mode=game');
  await page.getByRole('link', { name: 'Take the direct route.' }).click();
  await expect(page.getByRole('heading', { name: 'Destination' })).toBeVisible();
  const progressedUrl = page.url();
  const restart = page.locator('.story-restart-control');
  await restart.click();
  await expect(page.getByRole('heading', { name: 'Destination' })).toBeVisible();
  expect(page.url()).toBe(progressedUrl);
  const box = await restart.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect(restart).not.toHaveClass(/is-holding/);
  await expect(restart).toHaveCSS('--hold-progress', '0turn');
  await page.mouse.down();
  await restart.dispatchEvent('pointercancel', { pointerId: 1, button: 0, isPrimary: true });
  await page.mouse.up();
  await expect(restart).not.toHaveClass(/is-holding/);
  await page.mouse.down();
  await page.mouse.move(box.x - 10, box.y - 10);
  await page.mouse.up();
  await expect(restart).not.toHaveClass(/is-holding/);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(restart).not.toHaveClass(/is-holding/);
  await holdButton(page, restart);
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
  const session = await page.evaluate(() => JSON.parse(LZString.decompressFromEncodedURIComponent(location.hash.slice(1))));
  expect(session.events).toEqual([{ type: 'page', pageId: '1' }]);
  await expect(page.getByRole('button', { name: 'Hold to restart story' })).toBeFocused();
});

test('keyboard hold confirms while early keyup cancels', async ({ page }) => {
  await useStory(page);
  await page.goto('/?mode=game');
  await page.getByRole('link', { name: 'Take the direct route.' }).click();
  const restart = page.locator('.story-restart-control');
  await restart.focus();
  await page.keyboard.down('Enter');
  await page.waitForTimeout(100);
  await page.keyboard.up('Enter');
  await expect(page.getByRole('heading', { name: 'Destination' })).toBeVisible();
  await page.keyboard.down('Space');
  await page.waitForTimeout(975);
  await page.keyboard.up('Space');
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
});

test('local choices and context are cleared by the shared restart action', async ({ page }) => {
  await useStory(page, 'test-fixtures/choice-results/pages');
  await page.goto('/?mode=dev');
  await page.getByRole('button', { name: 'Ask whether he travels often.' }).click();
  await expect(page.getByText(/Every Thursday.*Result 1/)).toBeVisible();
  await expect(page.locator('.committed-choice-turn')).toHaveCount(1);
  await expect(page.locator('#state-container')).toContainText('knows_answer: true');
  await holdButton(page, page.getByRole('button', { name: 'Hold to restart story' }));
  await expect(page.locator('.committed-choice-turn')).toHaveCount(0);
  await expect(page.getByText(/Every Thursday.*Result 1/)).toHaveCount(0);
  await expect(page.locator('#state-container')).toContainText('knows_answer: false');
});

test('ending Play again preserves the completed URL until its shared hold confirms', async ({ page }) => {
  await useStory(page);
  await page.addInitScript(() => { Object.defineProperty(window, 'confirm', { value: () => { throw new Error('native confirmation must not run'); } }); });
  await page.goto('/?mode=game');
  await expect(page.locator('.story-ending-actions')).toBeHidden();
  await page.getByRole('link', { name: 'Take the direct route.' }).click();
  const playAgain = page.locator('.story-play-again');
  await expect(playAgain).toBeVisible();
  expect(await playAgain.evaluate(element => !document.querySelector('#content').contains(element))).toBe(true);
  const completedUrl = page.url();
  await playAgain.click();
  await expect(page.getByRole('heading', { name: 'Destination' })).toBeVisible();
  expect(page.url()).toBe(completedUrl);
  await playAgain.dispatchEvent('pointerdown', { pointerId: 20, button: 0, isPrimary: true });
  await page.waitForTimeout(100);
  await playAgain.dispatchEvent('pointerup', { pointerId: 20, button: 0, isPrimary: true });
  expect(page.url()).toBe(completedUrl);
  await holdButton(page, playAgain);
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
  await expect(page.getByRole('button', { name: 'Hold to restart story' })).toBeVisible();
  await expect(page.locator('.story-view-toggle')).toHaveCount(0);
  expect(devRequests).toEqual([]);
  await context.close();
});

test('shared restart reset contains no browser-native confirmation', async () => {
  const source = await readFile(path.join(root, 'runtime/script.js'), 'utf8');
  expect(source).not.toContain('window.confirm');
  expect(source).not.toContain('Restart the story? Your current progress will be lost.');
  expect(source.match(/createHoldToConfirmControl/g)?.length).toBe(3);
});
