#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ICONS = ['alert-triangle', 'brand-vscode', 'check', 'chevron-down', 'chevron-up', 'refresh', 'x'];
const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'node_modules', '@tabler', 'icons', 'icons', 'outline');
const output = path.join(root, 'assets', 'icons.svg');

function symbol(name) {
  const file = path.join(sourceRoot, `${name}.svg`);
  if (!fs.existsSync(file)) throw new Error(`Unknown Tabler icon: ${name}`);
  const svg = fs.readFileSync(file, 'utf8');
  const body = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>')).trim();
  return `  <symbol id="icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n    ${body.replace(/\n/g, '\n    ')}\n  </symbol>`;
}

function generate(names = ICONS) {
  return `<!-- Generated from @tabler/icons 3.34.1 (MIT). Run npm run generate-icons. -->\n<svg xmlns="http://www.w3.org/2000/svg">\n${names.map(symbol).join('\n')}\n</svg>\n`;
}

if (require.main === module) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, generate());
  console.log(`Generated ${path.relative(root, output)} (${ICONS.length} icons)`);
}

module.exports = { ICONS, generate, output };
