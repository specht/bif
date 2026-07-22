import { expect, test } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import storyAnalyzer from '../tools/lib/story-analyzer.js';
import publicationTools from '../tools/lib/browser-analysis-publication.js';

const { analyzeStory } = storyAnalyzer;
const { buildBrowserAnalysisPublication } = publicationTools;
const completeRoot = path.join(process.cwd(), 'test-fixtures/authoring-graph/complete-project');
const escapingRoot = path.join(process.cwd(), 'test-fixtures/authoring-graph/escaping');
const brokenEntryRoot = path.join(process.cwd(), 'test-fixtures/broken-entry');
let complete;
let hostile;
let brokenEntry;
let activePublication;

test.beforeAll(async () => {
  complete = buildBrowserAnalysisPublication(await analyzeStory(completeRoot));
  hostile = buildBrowserAnalysisPublication(await analyzeStory(escapingRoot));
  brokenEntry = buildBrowserAnalysisPublication(await analyzeStory(brokenEntryRoot));
  activePublication = buildBrowserAnalysisPublication(await analyzeStory(process.cwd()));
});

async function configure(page, fixturePath, publicationProvider) {
  if (fixturePath === 'test-fixtures/authoring-graph/complete-project/pages') {
    await page.route(/\/test-fixtures\/authoring-graph\/complete-project\/pages\/1\.md\?/, async route => {
      const source = await (await import('node:fs/promises')).readFile(path.join(completeRoot, 'pages/1.md'), 'utf8');
      return route.fulfill({ contentType: 'text/markdown', body: source.replace('broken +', '2 + 3').replace('condition="has_key"', 'condition="false"') });
    });
  }
  await page.route(/\/config\.js\?.*/, route => route.fulfill({
    contentType: 'text/javascript',
    body: `export const path = ${JSON.stringify(fixturePath)};`,
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

test('broken entry passage keeps the complete development shell alive across reload', async ({ page }) => {
  let publication = brokenEntry;
  let entrySource = await readFile(path.join(brokenEntryRoot, 'pages/1.md'), 'utf8');
  await configure(page, 'test-fixtures/broken-entry/pages', () => publication);
  await page.route(/\/pages\/1\.md$/, async route => route.fulfill({
    contentType: 'text/markdown',
    body: entrySource,
  }));
  await page.route(/\/test-fixtures\/broken-entry\/pages\/1\.md\?/, async route => route.fulfill({
    contentType: 'text/markdown',
    body: entrySource,
  }));
  await page.goto('/?mode=dev');

  await expect(page).toHaveTitle('Broken entry fixture');
  await expect(page.locator('.development-title-row')).toBeVisible();
  await expect(page.locator('.development-title-row #bu_reset_game')).toBeVisible();
  await expect(page.locator('#project-analysis-summary')).not.toContainText('Broken entry fixture');
  await expect(page.locator('#graph-container')).toBeVisible();
  await expect(page.locator('#graph-container svg')).toHaveCount(1);
  await expect(page.locator('#development-inspector')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Problems/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'State' })).toBeVisible();
  await expect(page.locator('.problem-message')).toContainText('Assigning to rvalue (line 8)');
  await expect(page.locator('.problem-source-host')).toContainText('crew_count = 12;     1 = 2;');
  await expect(page.locator('#content .story-error')).toHaveCount(1);
  await expect(page.locator('#content .story-error')).toHaveText('This passage could not be completed.See Problems below for details.');
  await expect(page.locator('#content')).not.toContainText(/later prose|Forbidden later choice|Assigning to rvalue|SyntaxError|ReferenceError|\(2:21\)/);
  await expect(page.locator('#content .story-passage')).toHaveCount(0);
  await expect(page.locator('nav > #bu_reset_game')).toHaveCount(0);
  expect(await page.locator('#state-container').evaluate(element => element.parentElement.id)).toBe('development-state');
  expect(await page.evaluate(() => [...document.body.children].some(element => element.textContent.trim() === '{}'))).toBe(false);
  await expect(page.locator('#fatal-application-error')).toHaveCount(0);

  await page.getByRole('tab', { name: 'State' }).click();
  await page.getByRole('button', { name: 'Collapse' }).click();
  const savedHash = new URL(page.url()).hash;
  await page.reload();
  await expect(page.locator('#graph-container svg')).toHaveCount(1);
  await expect(page.locator('#content .story-error')).toHaveCount(1);
  await expect(page.locator('#development-inspector')).toHaveClass(/collapsed/);
  await expect(page.getByRole('tab', { name: 'State' })).toHaveAttribute('aria-selected', 'true');
  expect(new URL(page.url()).hash).toBe(savedHash);
  await expect(page.locator('#fatal-application-error')).toHaveCount(0);

  entrySource = entrySource.replace('crew_count = 12;     1 = 2;', 'crew_count = 12;');
  publication = {
    ...brokenEntry,
    analysisHash: 'f'.repeat(64),
    summary: { ...brokenEntry.summary, errors: 0 },
    diagnostics: [],
  };
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Broken entry passage' })).toBeVisible();
  await expect(page.locator('#content .story-error')).toHaveCount(0);
  await expect(page.locator('#content')).toContainText('This later prose must not appear.');
  await expect(page.getByRole('link', { name: 'Forbidden later choice' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe(savedHash);
});

test('active analysis preserves the compact visual contract and prevents recursive crawling', async ({ page }) => {
  const markdown = [];
  await page.route(/\/\.story-tools\/analysis\.json\?v=\d+$/, route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(activePublication),
  }));
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
  await expect(page.locator('.problem-path').filter({ hasText: 'pages/1.md' })).not.toHaveCount(0);
  await expect(page.locator('#project-problems')).not.toContainText(process.cwd());
  const before = await snapshot(page);
  await page.locator('.project-problem', { hasText: 'unreachable' }).click();
  await expect(page.locator('#node_99')).toHaveClass(/graph-selected/);
  const after = await snapshot(page);
  expect(after).toEqual(before);
});

test('summary hides zero metrics and Problems sort and wrap as a flat list', async ({ page }) => {
  const clean = {
    ...complete,
    contentHash: 'c'.repeat(64),
    analysisHash: 'c'.repeat(64),
    summary: { ...complete.summary, errors: 0, warnings: 0, unreachablePages: 0, missingTargets: 0 },
    diagnostics: [],
  };
  let publication = clean;
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => publication);
  await page.goto('/?dev');
  const summary = page.locator('#project-analysis-counts');
  await expect(page).toHaveTitle('Start of the authoring map');
  await expect(page.locator('.development-title-row')).not.toContainText('Start of the authoring map');
  await expect(page.locator('.development-title-row')).toContainText('Restart');
  await expect(page.locator('.development-summary-items').first()).toHaveText(/^3 pages/);
  await expect(summary).toContainText('No problems');
  for (const metric of ['errors', 'warnings', 'unreachable', 'missing']) await expect(page.locator(`.project-analysis-${metric}`)).toBeHidden();

  publication = complete;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('tab', { name: `Problems (${complete.diagnostics.length})` })).toBeVisible();
  await expect(page.locator('.problem-file-group, .problem-file-header')).toHaveCount(0);
  const files = await page.locator('.problem-path').allTextContents();
  expect(files).toEqual([...files].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  const locations = await page.locator('.problem-location').allTextContents();
  expect(locations.every(location => !location.includes(process.cwd()))).toBe(true);
  const overflow = await page.locator('#project-problems').evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  await expect(page.locator('.problem-severity').first()).toContainText(/Error|Warning/);
});

test('Problems formats semantic diagnostics with page-level lines', async ({ page }) => {
  const diagnostic = { ...complete.diagnostics[0], file: 'pages/1.md', line: 16, column: 21, message: 'Script 1: Assigning to rvalue (2:21)', scriptIndex: 1, scriptLine: 2, scriptColumn: 21 };
  const unlocated = { severity: 'warning', code: 'project-note', file: '', message: 'Meaningful (context)' };
  const publication = { ...complete, analysisHash: 'd'.repeat(64), diagnostics: [diagnostic, unlocated] };
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => publication);
  await page.goto('/?dev');
  const row = page.locator('.project-problem', { hasText: 'Assigning to rvalue' });
  await expect(row).toContainText('Assigning to rvalue (line 16)');
  await expect(row).not.toContainText('(2:21)');
  await expect(row).not.toContainText('Script 1');
  await expect(row.locator('.problem-path')).toHaveText('pages/1.md');
  await expect(row).toHaveAttribute('title', 'pages/1.md, line 16, column 21: Assigning to rvalue');
  await expect(page.locator('.problem-file-group, .problem-file-header')).toHaveCount(0);
  await expect(page.locator('.project-problem', { hasText: 'Meaningful (context)' })).not.toContainText('(line undefined)');
  await expect(page.locator('.problem-location')).toHaveCount(0);
  const normalized = await page.evaluate(async diagnostic => {
    const messages = await import(`/lib/browser-diagnostic-message.js?test=${Date.now()}`);
    const client = await import(`/lib/browser-analysis-client.js?test=${Date.now()}`);
    const publication = {
      schemaVersion: 1,
      contentHash: 'same-source',
      project: { title: 'Compatibility', pagesPath: 'pages', startPage: '1' },
      summary: { pages: 1, reachablePages: 1, unreachablePages: 0, choices: 0, groups: 0, missingTargets: 0, errors: 1, warnings: 0 },
      nodes: [{ diagnostics: [diagnostic] }], edges: [], groups: [], diagnostics: [diagnostic],
    };
    const first = messages.normalizeBrowserDiagnostic(diagnostic);
    const second = messages.normalizeBrowserDiagnostic(first);
    const parsed = client.validateBrowserAnalysis(publication).model;
    return {
      first: first.message,
      second: second.message,
      ingested: parsed.diagnostics[0].message,
      nested: parsed.nodes[0].diagnostics[0].message,
      meaningful: messages.getPublicDiagnosticMessage({ message: 'Meaningful (context)', line: 4 }),
    };
  }, diagnostic);
  expect(normalized).toEqual({
    first: 'Assigning to rvalue', second: 'Assigning to rvalue',
    ingested: 'Assigning to rvalue', nested: 'Assigning to rvalue',
    meaningful: 'Meaningful (context)',
  });
});

test('a missing configured story path shows its config.js source in Problems', async ({ page }) => {
  const configSource = 'export const path = "pages-that-do-not-exist";';
  const analysis = await analyzeStory(path.join(process.cwd(), 'test-fixtures/analyzer/missing-pages-path'));
  const publication = buildBrowserAnalysisPublication(analysis);
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => publication);
  await page.route(/\/config\.js$/, route => route.fulfill({ contentType: 'text/javascript', body: configSource }));
  await page.goto('/?dev');
  const problem = page.locator('.project-problem', { hasText: 'Configured story directory does not exist' });
  await expect(problem).toContainText('config.js');
  await expect(problem).toContainText('pages-that-do-not-exist');
  await expect(problem).toContainText('(line 1)');
  const snippet = page.locator('.problem-source-snippet');
  await expect(snippet).toContainText(configSource);
  await expect(snippet.locator('.problem-source-diagnostic-line')).toHaveCount(1);
  const marker = snippet.locator('.problem-source-range.exact');
  await expect(marker).toHaveCount(1);
  expect(await marker.evaluate(element => ({
    column: element.style.getPropertyValue('--marker-column'),
    width: element.style.getPropertyValue('--marker-width'),
  }))).toEqual({ column: '21', width: '25' });
});

test('real bork publication and browser output keep parser-local context internal', async ({ page }) => {
  const root = path.join(process.cwd(), 'test-fixtures/analyzer/bork-script-page4');
  const publication = buildBrowserAnalysisPublication(await analyzeStory(root));
  const diagnostic = publication.diagnostics.find(item => item.code === 'script-syntax');
  expect(diagnostic).toMatchObject({ message: 'Unexpected token', file: 'pages/4.md', line: 21, scriptIndex: 1, scriptLine: 3, scriptColumn: 9 });
  await configure(page, 'test-fixtures/analyzer/bork-script-page4/pages', () => publication);
  await page.goto('/?dev');
  const message = page.locator('.problem-message', { hasText: 'Unexpected token' });
  await expect(message).toHaveText('Unexpected token (line 21)');
  await expect(message.locator('..').locator('.problem-path')).toHaveText('pages/4.md');
  await expect(page.locator('#project-problems')).not.toContainText('Script 1');
  await expect(page.locator('#project-problems')).not.toContainText('(3:9)');
  await page.getByRole('link', { name: 'Open the broken passage' }).click();
  await expect(page.locator('#content .story-error')).toHaveText('This passage could not be completed.See Problems below for details.');
});

test('a newer analysis identity refreshes a legacy diagnostic with the same source identity', async ({ page }) => {
  const legacy = {
    ...complete,
    contentHash: 'a'.repeat(64),
    analysisHash: 'b'.repeat(64),
    diagnostics: [{ severity: 'error', code: 'script-syntax', file: 'pages/4.md', line: 21, column: 10, message: 'Script 1: Unexpected token (3:9)', scriptIndex: 1, scriptLine: 3, scriptColumn: 9 }],
  };
  let publication = legacy;
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => publication);
  await page.goto('/?dev');
  const message = page.locator('.problem-message', { hasText: 'Unexpected token' });
  await expect(message).toHaveText('Unexpected token (line 21)');

  publication = {
    ...legacy,
    analysisHash: 'c'.repeat(64),
    diagnostics: [{ ...legacy.diagnostics[0], message: 'Unexpected token', line: 22 }],
  };
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(message).toHaveText('Unexpected token (line 22)');
  await expect(page.locator('#project-problems')).not.toContainText(/Script 1|\(3:9\)/);
});

test('problem source is immediate, cached per file, marked, highlighted, and safely rendered', async ({ page }) => {
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => complete);
  let sourceRequests = 0;
  await page.route(/\/pages\/1\.md$/, async route => {
    sourceRequests += 1;
    await route.fulfill({ contentType: 'text/markdown', body: await (await import('node:fs/promises')).readFile(path.join(completeRoot, 'pages/1.md'), 'utf8') });
  });
  await page.goto('/?dev');
  const row = page.locator('.project-problem', { hasText: 'missing page' }).first();
  await expect(page.locator('.problem-source-snippet').first()).toBeVisible();
  expect(sourceRequests).toBe(1);
  await expect(page.locator('.problem-source-line-number')).not.toHaveCount(0);
  await expect(page.locator('.problem-source-range')).not.toHaveCount(0);
  await expect(page.locator('.token-link')).not.toHaveCount(0);
  const typography = await page.locator('.problem-source-snippet').first().evaluate(element => {
    const selectors = ['.problem-source-line-number', '.problem-source-text', '.problem-source-range', '.token-link'];
    return selectors.map(selector => {
      const style = getComputedStyle(element.querySelector(selector));
      return `${style.fontSize}/${style.lineHeight}`;
    });
  });
  expect(new Set(typography).size).toBe(1);
  await row.click();
  expect(sourceRequests).toBe(1);
  await expect(row.locator('xpath=..').locator('.problem-open-source')).toHaveCount(0);
  await expect(row).not.toHaveAttribute('href');
  await expect(page.getByRole('button', { name: 'Copy location' })).toHaveCount(0);
});

test('Problems rows have no editor action column and never overflow', async ({ page }) => {
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => complete);
  await page.goto('/?dev');
  const item = page.locator('.problem-item').first();
  await expect(item.locator('.problem-open-source')).toHaveCount(0);

  for (const width of [1280, 760]) {
    await page.setViewportSize({ width, height: 720 });
    const geometry = await item.evaluate(element => {
      const rectangle = selector => element.querySelector(selector).getBoundingClientRect().toJSON();
      const heading = element.querySelector('.project-problem');
      const panel = document.querySelector('#project-problems');
      return { columns: getComputedStyle(heading).gridTemplateColumns.split(' ').length, overflow: panel.scrollWidth > panel.clientWidth };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.columns).toBe(3);
  }

  const row = item.locator('.project-problem');
  await expect(row).not.toHaveAttribute('role', 'button');
  await expect(row).not.toHaveAttribute('tabindex');
  const styles = await row.evaluate(element => ({ cursor: getComputedStyle(element).cursor, background: getComputedStyle(element).backgroundColor }));
  await row.hover();
  expect(await row.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(styles.background);
  expect(styles.cursor).not.toBe('pointer');
});

test('shared icons align with labels and clean text remains neutral', async ({ page }) => {
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => complete);
  await page.goto('/?dev');
  await expect(page.locator('.project-analysis-errors')).toBeVisible();
  const aligned = await page.evaluate(() => {
    const selectors = ['.project-analysis-errors', '.development-inspector-collapse'];
    return selectors.map(selector => {
      const pair = document.querySelector(selector);
      const icon = pair.querySelector('.icon').getBoundingClientRect();
      const label = pair.querySelector('.icon-label').getBoundingClientRect();
      return { selector, difference: Math.abs((icon.top + icon.bottom) / 2 - (label.top + label.bottom) / 2), ariaHidden: pair.querySelector('.icon').getAttribute('aria-hidden') };
    });
  });
  expect(aligned.every(item => item.difference <= 2 && item.ariaHidden === 'true')).toBe(true);

  const clean = { ...complete, analysisHash: 'e'.repeat(64), summary: { ...complete.summary, errors: 0, warnings: 0, unreachablePages: 0, missingTargets: 0 }, diagnostics: [] };
  await page.route(/\/\.story-tools\/analysis\.json\?v=\d+$/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(clean) }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.project-analysis-clean')).toBeVisible();
  const colors = await page.evaluate(() => ({
    wrapper: getComputedStyle(document.querySelector('.project-analysis-clean')).color,
    icon: getComputedStyle(document.querySelector('.project-analysis-clean .icon')).color,
    text: getComputedStyle(document.querySelector('.project-analysis-clean .icon-label')).color,
    normal: getComputedStyle(document.querySelector('.project-analysis-pages')).color,
  }));
  expect(colors.text).toBe(colors.normal);
  expect(colors.wrapper).toBe(colors.normal);
  expect(colors.icon).not.toBe(colors.normal);
});

test('authoring toolbar intentionally omits the title and remains compact and responsive', async ({ page }) => {
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => complete);
  await page.goto('/?dev');
  await expect(page.locator('.problem-source-text').first()).toBeVisible();
  const desktop = await page.evaluate(() => {
    const row = document.querySelector('.development-title-row').getBoundingClientRect();
    const pages = document.querySelector('.project-analysis-pages').getBoundingClientRect();
    const restart = document.querySelector('#bu_reset_game').getBoundingClientRect();
    const selectors = ['.project-analysis-pages', '#bu_reset_game', '#problems-tab', '.development-inspector-collapse', '.project-problem', '.problem-source-text'];
    return {
      row: row.toJSON(), pages: pages.toJSON(), restart: restart.toJSON(),
      fonts: selectors.map(selector => getComputedStyle(document.querySelector(selector)).fontSize),
      lines: selectors.slice(0, -1).map(selector => getComputedStyle(document.querySelector(selector)).lineHeight),
    };
  });
  await expect(page).toHaveTitle('Start of the authoring map');
  await expect(page.locator('.project-analysis-title')).toHaveCount(0);
  await expect(page.locator('.development-summary-items')).not.toContainText('Complete authoring fixture');
  await expect(page.locator('#project-analysis-counts')).toHaveText(/^3 pages/);
  expect(desktop.pages.left).toBeLessThan(desktop.restart.left);
  expect(Math.abs(desktop.pages.top - desktop.restart.top)).toBeLessThan(8);
  expect(desktop.row.height).toBeLessThan(38);
  expect(new Set(desktop.fonts).size).toBe(1);
  expect(new Set(desktop.lines).size).toBe(1);
  await expect(page.locator('#graph-toolbar')).toHaveCount(0);
  const actions = page.locator('.development-toolbar-actions');
  await expect(actions.getByRole('button')).toHaveText(['Restart', 'Fit graph']);
  await expect(page.getByRole('button', { name: 'Auto-follow' })).toHaveCount(0);
  const actionGeometry = await actions.getByRole('button').evaluateAll(elements => elements.map(element => ({
    height: element.getBoundingClientRect().height,
    fontSize: getComputedStyle(element).fontSize,
  })));
  expect(Math.max(...actionGeometry.map(item => item.height)) - Math.min(...actionGeometry.map(item => item.height))).toBeLessThanOrEqual(1);
  expect(new Set(actionGeometry.map(item => item.fontSize)).size).toBe(1);

  await page.setViewportSize({ width: 620, height: 720 });
  const narrow = await page.evaluate(() => ({
    pages: document.querySelector('.project-analysis-pages').getBoundingClientRect().width,
    restart: document.querySelector('#bu_reset_game').getBoundingClientRect().width,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  expect(narrow.pages).toBeGreaterThan(0);
  expect(narrow.restart).toBeGreaterThan(0);
  expect(narrow.overflow).toBe(false);
});

test('graph wheel, pointer, touch, and Fit update one visible viewport without Auto-follow', async ({ page }) => {
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => complete);
  await page.goto('/?dev');
  const svg = page.locator('#graph-container svg');
  await expect(page.getByRole('button', { name: 'Auto-follow' })).toHaveCount(0);
  const original = await svg.getAttribute('viewBox');
  const box = await svg.boundingBox();
  await svg.dispatchEvent('wheel', { deltaY: -90, clientX: box.x + 40, clientY: box.y + 40 });
  await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(original);

  const afterWheel = await svg.getAttribute('viewBox');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 20);
  await page.mouse.up();
  await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(afterWheel);

  const touchResult = await svg.evaluate(element => {
    const fire = (type, pointerId, x, y) => element.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId, pointerType: 'touch', isPrimary: pointerId === 11, button: 0, clientX: x, clientY: y }));
    const before = element.getAttribute('viewBox');
    const capture = element.setPointerCapture;
    const release = element.releasePointerCapture;
    const has = element.hasPointerCapture;
    element.setPointerCapture = () => {};
    element.releasePointerCapture = () => {};
    element.hasPointerCapture = () => false;
    const rect = element.getBoundingClientRect();
    fire('pointerdown', 11, rect.left + 120, rect.top + 120);
    fire('pointerdown', 12, rect.left + 220, rect.top + 120);
    fire('pointermove', 11, rect.left + 95, rect.top + 135);
    fire('pointermove', 12, rect.left + 255, rect.top + 145);
    fire('pointercancel', 11, rect.left + 95, rect.top + 135);
    fire('pointerup', 12, rect.left + 255, rect.top + 145);
    element.setPointerCapture = capture;
    element.releasePointerCapture = release;
    element.hasPointerCapture = has;
    return { before, after: element.getAttribute('viewBox'), touchAction: getComputedStyle(element).touchAction };
  });
  expect(touchResult.after).not.toBe(touchResult.before);
  expect(touchResult.touchAction).toBe('none');
  await expect(page.locator('#graph-container svg')).toHaveCount(1);

  await page.getByRole('button', { name: 'Fit graph' }).click();
  await expect(page.locator('#graph-container svg')).toHaveCount(1);
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
  await expect.poll(() => page.locator('#graph-container').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(openHeight);
  await expect(page.locator('#development-state')).toBeHidden();
  const viewport = await page.locator('#dev_fixed').evaluate(element => ({
    bottom: element.getBoundingClientRect().bottom,
    viewport: innerHeight,
    htmlOverflow: getComputedStyle(document.documentElement).overflowY,
  }));
  expect(viewport.bottom).toBeLessThanOrEqual(viewport.viewport);
  expect(viewport.htmlOverflow).toBe('hidden');
});

test('resizable inspector and development UI state survive reload without rebuilding story state', async ({ page }) => {
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => complete);
  await page.goto('/?dev');
  const inspector = page.locator('#development-inspector');
  const separator = page.getByRole('separator', { name: 'Resize development inspector' });
  const svg = page.locator('#graph-container svg');
  const beforeHeight = await inspector.evaluate(element => element.getBoundingClientRect().height);
  const handleBox = await separator.boundingBox();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y - 20);
  await page.mouse.up();
  await expect.poll(() => inspector.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(beforeHeight);
  await separator.focus();
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(() => inspector.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(beforeHeight);
  const resizedHeight = Number(await separator.getAttribute('aria-valuenow'));
  await expect.poll(() => inspector.evaluate((element, expected) => Math.abs(element.getBoundingClientRect().height - expected), resizedHeight)).toBeLessThan(7);
  await page.getByRole('tab', { name: 'State' }).click();
  const originalViewBox = await svg.getAttribute('viewBox');
  await svg.dispatchEvent('wheel', { deltaY: -100, clientX: 300, clientY: 200 });
  await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(originalViewBox);
  const savedViewBox = await svg.getAttribute('viewBox');
  await page.reload();
  await expect(page.getByRole('tab', { name: 'State' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => inspector.evaluate((element, expected) => Math.abs(element.getBoundingClientRect().height - expected), resizedHeight)).toBeLessThan(7);
  await expect(page.locator('#graph-container svg')).toHaveAttribute('viewBox', savedViewBox);
  await expect(page.locator('#graph-container svg')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Auto-follow' })).toHaveCount(0);
  const storage = await page.evaluate(() => Object.values(sessionStorage).join('\n'));
  expect(storage).not.toContain('graphAutoFollow');
  expect(storage).not.toContain(process.cwd());
  expect(storage).not.toContain('crew_count');
});

test('parallel runtime choices map to distinct analysis edge identities', async ({ page }) => {
  const parallel = { ...complete, edges: complete.edges.map(edge => ({ ...edge, condition: null })) };
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => parallel);
  await page.route(/\/complete-project\/pages\/1\.md\?.*/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('broken +', '2 + 3').replace(' condition="has_key"', '') });
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

test('graph navigation preserves pointer and keyboard focus modality', async ({ page }) => {
  await configure(page, 'test-fixtures/authoring-graph/complete-project/pages', () => complete);
  await page.goto('/?dev');
  await page.locator('#node_2').click();
  await expect(page.getByRole('heading', { name: 'The high pass' })).toBeVisible();
  expect(await page.locator('.story-passage[data-page-id="2"]').evaluate(element => ({
    focused: document.activeElement === element,
    outline: getComputedStyle(element).outlineStyle,
  }))).toEqual({ focused: false, outline: 'none' });

  await page.locator('#node_1').click();
  await expect(page.locator('.story-passage')).toHaveCount(1);
  await page.locator('#node_2').focus();
  await page.keyboard.press('Enter');
  const passage = page.locator('.story-passage[data-page-id="2"]');
  await expect(passage).toBeFocused();
  expect(await passage.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await expect(page.getByRole('heading', { name: 'The high pass' })).toHaveCount(1);
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
  publication = { ...complete, analysisHash: 'b'.repeat(64), summary: { ...complete.summary, pages: complete.summary.pages + 1 }, nodes: [...complete.nodes, added] };
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
