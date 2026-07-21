import { expect, test } from '@playwright/test';
import path from 'node:path';
import storyAnalyzer from '../tools/lib/story-analyzer.js';
import publicationTools from '../tools/lib/browser-analysis-publication.js';

const { analyzeStory } = storyAnalyzer;
const { buildBrowserAnalysisPublication } = publicationTools;
const completeRoot = path.join(process.cwd(), 'test-fixtures/authoring-graph/complete-project');
const escapingRoot = path.join(process.cwd(), 'test-fixtures/authoring-graph/escaping');
let complete;
let hostile;

test.beforeAll(async () => {
  complete = buildBrowserAnalysisPublication(await analyzeStory(completeRoot));
  hostile = buildBrowserAnalysisPublication(await analyzeStory(escapingRoot));
});

async function configure(page, fixturePath, publicationProvider) {
  await page.route(/\/config\.js\?.*/, route => route.fulfill({
    contentType: 'text/javascript',
    body: `export const title = 'Unified graph fixture'; export const path = ${JSON.stringify(fixturePath)};`,
  }));
  await page.route(/\/\.story-tools\/analysis\.json\?v=\d+$/, route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(publicationProvider()),
  }));
}

function snapshot(page) {
  return page.evaluate(() => ({
    hash: location.hash,
    historyLength: history.length,
    transcript: document.querySelector('#content').textContent,
    passages: document.querySelectorAll('.story-passage').length,
    runtime: document.querySelector('#state-container').textContent,
    current: document.querySelector('.story-passage:last-of-type')?.dataset.pageId,
    focus: document.activeElement?.textContent,
    scroll: document.querySelector('#game_pane').scrollTop,
  }));
}

test('active analysis preserves the compact visual contract and prevents recursive crawling', async ({ page }) => {
  const markdown = [];
  page.on('request', request => { if (/\/pages\/\d+\.md\?/.test(request.url())) markdown.push(request.url()); });
  await page.goto('/?dev');
  await expect(page.locator('#graph-container')).toHaveAttribute('data-graph-source', 'analysis');
  await expect(page.locator('#graph-container svg')).toHaveCount(1);
  expect(markdown).toHaveLength(1);
  await expect(page.getByRole('button', { name: /Play|Project/ })).toHaveCount(0);
  await expect(page.locator('#node_1')).toContainText('1 Start');
  await expect(page.locator('#node_13')).toContainText('13');
  await expect(page.locator('#graph-container .cluster')).toHaveCount(3);
  const geometry = await page.evaluate(() => {
    const pane = document.querySelector('#graph-container').getBoundingClientRect();
    const graph = document.querySelector('#graph-container g.graph').getBoundingClientRect();
    const clusters = [...document.querySelectorAll('#graph-container .cluster polygon')].map(item => getComputedStyle(item).fill);
    const edgeText = [...document.querySelectorAll('#graph-container .edge text')].map(item => item.textContent.trim()).filter(Boolean);
    const startFill = getComputedStyle(document.querySelector('#node_1 polygon')).fill;
    return { pane: pane.toJSON(), graph: graph.toJSON(), clusters, edgeText, startFill };
  });
  expect(geometry.graph.left).toBeGreaterThanOrEqual(geometry.pane.left);
  expect(geometry.graph.right).toBeLessThanOrEqual(geometry.pane.right);
  expect(geometry.clusters.every(fill => fill !== 'rgba(0, 0, 0, 0)' && fill !== 'none')).toBe(true);
  expect(geometry.edgeText).toEqual([]);
  expect(geometry.startFill).not.toBe('rgb(0, 0, 0)');
});

test('one graph shows complete structure and contextual Problems', async ({ page }) => {
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => complete);
  await page.goto('/?dev');
  await expect(page.locator('#graph-container')).toHaveAttribute('data-graph-source', 'analysis');
  await expect(page.locator('#graph-container svg')).toHaveCount(1);
  await expect(page.locator('#node_1')).toBeVisible();
  await expect(page.locator('#node_2')).toBeVisible();
  await expect(page.locator('#node_3')).toBeVisible();
  await expect(page.locator('#node_99')).toBeVisible();
  await expect(page.locator('#graph-container .edge')).toHaveCount(complete.edges.length);
  await expect(page.getByRole('tab', { name: `Problems (${complete.diagnostics.length})` })).toBeVisible();
  await page.locator('#node_99').click();
  await expect(page.locator('#project-problems')).toBeVisible();
  await expect(page.locator('.project-problem.selected')).toContainText('missing page');
  await expect(page.locator('.project-problem')).toHaveCount(complete.diagnostics.length);
  await expect(page.locator('#project-problems')).toContainText('pages/1.md:');
  await expect(page.locator('#project-problems')).not.toContainText(process.cwd());
  const before = await snapshot(page);
  await page.locator('.project-problem', { hasText: 'missing page' }).click();
  await expect(page.locator('#node_99')).toHaveClass(/graph-selected/);
  const after = await snapshot(page);
  expect({ ...after, focus: before.focus }).toEqual(before);
  expect(after.focus).toContain('missing page');
});

test('docked Problems and State inspector preserves graph and story behavior', async ({ page }) => {
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => complete);
  await page.goto('/?dev');
  const inspector = page.locator('#development-inspector');
  const problemsTab = page.getByRole('tab', { name: `Problems (${complete.diagnostics.length})` });
  const stateTab = page.getByRole('tab', { name: 'State' });
  await expect(inspector).toBeVisible();
  await expect(problemsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#state-container')).toHaveCSS('position', 'static');
  expect(await page.locator('#state-container').evaluate(element => element.parentElement.id)).toBe('development-state');
  const svg = await page.locator('#graph-container svg').elementHandle();
  const before = await snapshot(page);

  await problemsTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(stateTab).toBeFocused();
  await expect(stateTab).toHaveAttribute('aria-selected', 'true');
  await page.getByText('Take the bright road').click();
  await expect(page.getByRole('heading', { name: 'The high pass' })).toBeVisible();
  await expect(page.locator('#state-container')).toBeVisible();
  expect(await page.evaluate(([first, current]) => first === current, [svg, await page.locator('#graph-container svg').elementHandle()])).toBe(true);
  expect(new URL(page.url()).hash).not.toBe(before.hash);

  const openHeight = await page.locator('#graph-container').evaluate(element => element.getBoundingClientRect().height);
  await page.getByRole('button', { name: 'Collapse' }).click();
  await expect(inspector).toHaveClass(/collapsed/);
  const collapsedHeight = await page.locator('#graph-container').evaluate(element => element.getBoundingClientRect().height);
  expect(collapsedHeight).toBeGreaterThan(openHeight);
  await expect(page.locator('#development-state')).toBeHidden();
  const viewport = await page.locator('#dev_fixed').evaluate(element => ({
    bottom: element.getBoundingClientRect().bottom,
    viewport: innerHeight,
    htmlOverflow: getComputedStyle(document.documentElement).overflowY,
  }));
  expect(viewport.bottom).toBeLessThanOrEqual(viewport.viewport);
  expect(viewport.htmlOverflow).toBe('hidden');
});

test('parallel runtime choices map to distinct analysis edge identities', async ({ page }) => {
  const parallel = { ...complete, edges: complete.edges.map(edge => ({ ...edge, condition: null })) };
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => parallel);
  await page.route(/\/complete-project\/pages\/1\.md\?.*/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace(' condition="has_key"', '') });
  });
  await page.goto('/?dev');
  const edges = complete.edges.filter(edge => edge.source === '1' && edge.target === '2');
  expect(edges).toHaveLength(2);
  const guarded = edges.find(edge => edge.text.includes('guarded'));
  await page.locator(`#${guarded.edgeId}`).click({ force: true });
  await expect(page.getByText('Take the guarded road')).toHaveClass(/chosen/);
  await expect(page.locator(`#${guarded.edgeId}`)).toHaveClass(/active/);
  await expect(page.locator(`#${edges.find(edge => edge !== guarded).edgeId}`)).not.toHaveClass(/active/);
});

test('conditional structure is visible but unavailable graph edges cannot navigate', async ({ page }) => {
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => complete);
  await page.goto('/?dev');
  const conditional = complete.edges.find(edge => edge.condition);
  await expect(page.locator(`#${conditional.edgeId}`)).toBeVisible();
  await expect(page.getByText('Take the guarded road')).toHaveCount(0);
  const before = await snapshot(page);
  await page.locator(`#${conditional.edgeId}`).click({ force: true });
  expect(await snapshot(page)).toEqual(before);
});

test('structural refresh replaces one SVG without replaying story state', async ({ page }) => {
  let publication = complete;
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => publication);
  await page.goto('/?dev');
  await page.getByText('Take the bright road').click();
  await expect(page.getByRole('heading', { name: 'The high pass' })).toBeVisible();
  await page.locator('#node_3').click();
  await expect(page.locator('#node_3')).toHaveClass(/graph-selected/);
  const before = await snapshot(page);
  const added = { ...complete.nodes[0], nodeId: 'node-page-6578747261', pageId: 'extra', graphLabel: 'Fresh page', start: false, group: '' };
  publication = { ...complete, contentHash: 'b'.repeat(64), summary: { ...complete.summary, pages: complete.summary.pages + 1 }, nodes: [...complete.nodes, added] };
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#node_extra')).toBeVisible();
  await expect(page.locator('#node_3')).toHaveClass(/graph-selected/);
  await expect(page.locator('#graph-container svg')).toHaveCount(1);
  const after = await snapshot(page);
  expect(after).toEqual(before);
});

test('hostile publication labels remain inert', async ({ page }) => {
  await configure(page, 'test-fixtures/authoring-graph/escaping/pages', () => hostile);
  await page.goto('/?dev');
  await expect(page.locator('#graph-container svg')).toHaveCount(1);
  await expect(page.locator('#graph-container script, #graph-container img, #graph-container a')).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.graphInjected)).toBeUndefined();
});

test('missing analysis falls back and shows an honest limited notice after grace', async ({ page }) => {
  await page.route(/\/\.story-tools\/analysis\.json/, route => route.fulfill({ status: 404 }));
  await page.goto('/?dev');
  await expect(page.locator('#graph-container')).toHaveAttribute('data-graph-source', 'recursive');
  await expect(page.locator('#limited-analysis-notice')).toBeHidden();
  await expect(page.locator('#limited-analysis-notice')).toBeVisible({ timeout: 6500 });
  await expect(page.locator('#limited-analysis-notice')).toContainText('npm run analysis -- --watch');
  await expect(page.getByRole('tab', { name: 'Problems (0)' })).toBeDisabled();
  await expect(page.locator('#node_1')).toBeVisible();
});
