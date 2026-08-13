const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { googleFontFamilies } = require('../../runtime/modules/story-metadata');

const GENERATED_DIRECTORY = 'bif-assets';
const MANIFEST_VERSION = 1;
const GOOGLE_CSS_ENDPOINT = 'https://fonts.googleapis.com/css2';
const GOOGLE_FONTS_REPOSITORY = 'https://raw.githubusercontent.com/google/fonts/main';
const FONT_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36';

function familySlug(family) {
  return family.toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, '');
}

function requestUrl(family) {
  const url = new URL(GOOGLE_CSS_ENDPOINT);
  url.searchParams.set('family', family);
  url.searchParams.set('display', 'swap');
  return url.toString();
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFontCss(family, fetchImpl) {
  const url = requestUrl(family);
  const response = await fetchWithTimeout(fetchImpl, url, {
    headers: { 'User-Agent': FONT_USER_AGENT, Accept: 'text/css,*/*;q=0.1' },
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 180);
    const suffix = detail ? `: ${detail}` : '';
    throw new Error(`Google Fonts rejected '${family}' (${response.status})${suffix}`);
  }
  const css = await response.text();
  if (!/@font-face\s*\{/i.test(css)) throw new Error(`Google Fonts returned no font data for '${family}'. Check the family name at fonts.google.com.`);
  return { css, sourceUrl: url };
}

function fontUrls(css) {
  const urls = [];
  for (const match of css.matchAll(/url\(\s*(['"]?)(https:\/\/[^)'"\s]+)\1\s*\)/gi)) {
    if (!urls.includes(match[2])) urls.push(match[2]);
  }
  return urls;
}

function extensionForUrl(url) {
  const pathname = new URL(url).pathname;
  const extension = path.posix.extname(pathname).toLowerCase();
  return /^\.[a-z0-9]{2,5}$/.test(extension) ? extension : '.woff2';
}

async function downloadFontFamily(family, outputDirectory, fetchImpl) {
  const slug = familySlug(family) || crypto.createHash('sha1').update(family).digest('hex').slice(0, 12);
  const { css, sourceUrl } = await fetchFontCss(family, fetchImpl);
  const urls = fontUrls(css);
  if (!urls.length) throw new Error(`Google Fonts returned no downloadable files for '${family}'.`);

  let rewritten = css;
  const files = [];
  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    const filename = `${slug}-${String(index + 1).padStart(2, '0')}${extensionForUrl(url)}`;
    const response = await fetchWithTimeout(fetchImpl, url, { headers: { 'User-Agent': FONT_USER_AGENT } });
    if (!response.ok) throw new Error(`Could not download '${family}' font data (${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(path.join(outputDirectory, filename), bytes);
    rewritten = rewritten.split(url).join(`fonts/${filename}`);
    files.push(`fonts/${filename}`);
  }

  const license = await downloadLicense(family, slug, outputDirectory, fetchImpl);
  if (license) files.push(license);
  return { family, css: `/* ${family} — locally cached from ${sourceUrl} */\n${rewritten.trim()}\n`, files, sourceUrl, license };
}

async function downloadLicense(family, slug, outputDirectory, fetchImpl) {
  const candidates = [
    [`ofl/${slug}/OFL.txt`, 'OFL.txt'],
    [`apache/${slug}/LICENSE.txt`, 'LICENSE.txt'],
    [`apache/${slug}/APACHE2.txt`, 'APACHE2.txt'],
    [`ufl/${slug}/UFL.txt`, 'UFL.txt'],
  ];
  for (const [relative, label] of candidates) {
    try {
      const response = await fetchWithTimeout(fetchImpl, `${GOOGLE_FONTS_REPOSITORY}/${relative}`, { headers: { 'User-Agent': FONT_USER_AGENT } }, 8000);
      if (!response.ok) continue;
      const text = await response.text();
      if (!text.trim()) continue;
      const filename = `${slug}-${label}`;
      await fs.writeFile(path.join(outputDirectory, filename), text, 'utf8');
      return `fonts/${filename}`;
    } catch {
      // License retrieval is best-effort; the font binary remains usable.
    }
  }
  return null;
}

async function readManifest(directory) {
  try {
    return JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function manifestIsCurrent(directory, families) {
  const manifest = await readManifest(directory);
  if (!manifest || manifest.version !== MANIFEST_VERSION || manifest.complete !== true) return false;
  if (JSON.stringify(manifest.families) !== JSON.stringify(families)) return false;
  if (!Array.isArray(manifest.files)) return false;
  for (const file of ['fonts.css', ...manifest.files]) {
    try { await fs.access(path.join(directory, file)); }
    catch { return false; }
  }
  return true;
}

async function removeGeneratedDirectory(storyDirectory) {
  await fs.rm(path.join(storyDirectory, GENERATED_DIRECTORY), { recursive: true, force: true });
}

async function syncStoryFonts(projectRoot, project, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { families: [], downloaded: false, errors: ['This Node.js version does not provide fetch(), so Google Fonts could not be downloaded.'], warnings: [] };

  const storyDirectory = path.resolve(projectRoot, project.pagesPath);
  const families = googleFontFamilies(project.appearance).sort((a, b) => a.localeCompare(b));
  const outputDirectory = path.join(storyDirectory, GENERATED_DIRECTORY);
  if (!families.length) {
    await removeGeneratedDirectory(storyDirectory);
    return { families, downloaded: false, errors: [], warnings: [] };
  }

  if (!options.force && await manifestIsCurrent(outputDirectory, families)) {
    return { families, downloaded: false, errors: [], warnings: [], cached: true };
  }

  const temporaryDirectory = path.join(storyDirectory, `.${GENERATED_DIRECTORY}.tmp-${process.pid}-${Date.now()}`);
  const temporaryFonts = path.join(temporaryDirectory, 'fonts');
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
  await fs.mkdir(temporaryFonts, { recursive: true });

  const blocks = [];
  const files = [];
  const errors = [];
  const warnings = [];
  const sources = [];
  try {
    for (const family of families) {
      try {
        const result = await downloadFontFamily(family, temporaryFonts, fetchImpl);
        blocks.push(result.css);
        files.push(...result.files);
        sources.push({ family, css: result.sourceUrl, license: result.license || null });
        if (!result.license) warnings.push(`Downloaded '${family}', but its license text could not be copied from the Google Fonts repository.`);
      } catch (error) {
        errors.push(error.message || String(error));
      }
    }

    const header = '/* Generated by BIF. Do not edit: change font_body/font_heading in 1.md instead. */\n\n';
    await fs.writeFile(path.join(temporaryDirectory, 'fonts.css'), `${header}${blocks.join('\n')}`, 'utf8');
    const manifest = { version: MANIFEST_VERSION, complete: errors.length === 0, families, files, sources };
    await fs.writeFile(path.join(temporaryDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    files.push('manifest.json');

    await fs.rm(outputDirectory, { recursive: true, force: true });
    await fs.rename(temporaryDirectory, outputDirectory);
    return { families, downloaded: true, errors, warnings, cached: false };
  } catch (error) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    return { families, downloaded: false, errors: [error.message || String(error)], warnings, cached: false };
  }
}

module.exports = {
  GENERATED_DIRECTORY,
  familySlug,
  requestUrl,
  fontUrls,
  syncStoryFonts,
  downloadFontFamily,
};
