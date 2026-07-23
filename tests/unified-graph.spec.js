import { expect, test } from '@playwright/test';
import path from 'node:path';
import { createHash } from 'node:crypto';
import storyAnalyzer from '../tools/lib/story-analyzer.js';
import publicationTools from '../tools/lib/browser-analysis-publication.js';

const { analyzeStory } = storyAnalyzer;
const { buildBrowserAnalysisPublication } = publicationTools;

test('published model keeps parallel edges, missing nodes, groups, and Problems together', async ({ page }) => {
  const project = 'test-fixtures/authoring-graph/complete-project';
  const publication = buildBrowserAnalysisPublication(await analyzeStory(path.join(process.cwd(), project)));
  publication.inputManifest = [];
  const config = `export const path = '${project}/pages';`;
  const hash = createHash('sha256').update(config).digest('hex');
  publication.inputManifest = [{ path: 'config.js', sha256: hash }];
  await page.route(/\/config\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: config }));
  await page.route(/\/\.story-tools\/analysis\.json(?:\?.*)?$/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(publication) }));
  await page.goto('/?mode=dev');
  await expect(page.locator('#node_99')).toBeVisible();
  await expect(page.locator('#graph-container .edge')).toHaveCount(publication.edges.length);
  await expect(page.getByRole('tab', { name: `Problems (${publication.diagnostics.length})` })).toBeVisible();
});
