#!/usr/bin/env node
// Generates registry.json and updates both README catalog tables.
// Pass --check in CI to ensure committed files are up to date.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectPlugin } from './schema.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const registryPath = join(root, 'registry.json');
const readmeNames = { zh: 'README.md', en: 'README.en.md' };
const COLUMNS = 3;
const catalogLabels = {
  zh: { empty: '_暂无收录的插件。_' },
  en: { empty: '_No plugins listed yet._' },
};
const START = '<!-- catalog:start -->';
const END = '<!-- catalog:end -->';

function normalizePreview(id, preview) {
  if (typeof preview === 'string') return `plugins/${id}/${preview}`;
  if (preview && typeof preview === 'object') {
    return {
      en: `plugins/${id}/${preview.en}`,
      zh: `plugins/${id}/${preview.zh}`,
    };
  }
  return null;
}

function previewFor(plugin, language) {
  if (!plugin.preview) return null;
  if (typeof plugin.preview === 'string') return plugin.preview;
  return plugin.preview[language] || plugin.preview.en || plugin.preview.zh || null;
}

const escapeCell = text => String(text).replace(/\|/g, '\\|');
const escapeAttr = text =>
  String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const formatRow = cells => `|${cells.map(c => (c ? ` ${c} ` : ' ')).join('|')}|`;

export function buildRegistry(baseDir = root) {
  const dir = join(baseDir, 'plugins');
  const ids = existsSync(dir)
    ? readdirSync(dir).filter(name => !name.startsWith('.') && statSync(join(dir, name)).isDirectory()).sort()
    : [];
  const entries = [];
  for (const id of ids) {
    const result = inspectPlugin(join(dir, id), id);
    if (!result.valid) throw Error(`Invalid plugin "${id}":\n  - ${result.errors.join('\n  - ')}`);
    const m = result.manifest;
    entries.push({
      id: m.id,
      version: m.version,
      mode: m.mode,
      minEngine: m.minEngine,
      name: m.name,
      description: m.description,
      author: m.author,
      license: m.license,
      category: m.category || 'tool',
      entry: m.mode === 'standard' ? m.entry : null,
      server: m.server || null,
      preview: normalizePreview(m.id, m.preview),
      permissions: m.permissions || [],
      config: m.config || {},
      path: `plugins/${m.id}`,
      readme: `plugins/${m.id}/README.md`,
      agentGuide: `plugins/${m.id}/AGENTS.md`,
    });
  }
  return { format: 1, plugins: entries };
}

export function renderCatalogMarkdown(registry, language) {
  const labels = catalogLabels[language];
  if (!registry.plugins.length) return labels.empty;
  const cols = Math.min(COLUMNS, registry.plugins.length);
  const rows = [];
  for (let i = 0; i < registry.plugins.length; i += cols) {
    const slice = registry.plugins.slice(i, i + cols);
    const isHeader = i === 0;
    const titles = [];
    const images = [];
    for (let c = 0; c < cols; c++) {
      const p = slice[c];
      if (!p) {
        titles.push('');
        images.push('');
        continue;
      }
      const name = escapeCell(p.name[language]);
      const author = escapeCell(p.author);
      const label = `[${name}](${p.path}/) (${author})`;
      titles.push(isHeader ? label : `**${label}**`);
      const preview = previewFor(p, language);
      images.push(
        preview
          ? `<a href="${p.path}/"><img src="${preview}" width="240" alt="${escapeAttr(p.name[language])}"></a>`
          : `[${name}](${p.path}/)`,
      );
    }
    rows.push(formatRow(titles));
    if (isHeader) rows.push(formatRow(Array(cols).fill(':---:')));
    rows.push(formatRow(images));
  }
  return rows.join('\n');
}

function syncReadme(readmeText, catalogMd) {
  const startIdx = readmeText.indexOf(START);
  const endIdx = readmeText.indexOf(END);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return readmeText;
  return `${readmeText.slice(0, startIdx + START.length)}\n${catalogMd}\n${readmeText.slice(endIdx)}`;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  const check = process.argv.includes('--check');
  const registry = buildRegistry(root);
  const expectedRegistry = JSON.stringify(registry, null, 2) + '\n';
  const currentRegistry = existsSync(registryPath) ? readFileSync(registryPath, 'utf8') : '';
  const readmes = Object.entries(readmeNames).map(([language, name]) => {
    const path = join(root, name);
    const current = readFileSync(path, 'utf8');
    const expected = syncReadme(current, renderCatalogMarkdown(registry, language));
    return { name, path, current, expected };
  });

  if (check) {
    const stale = [];
    if (currentRegistry !== expectedRegistry) stale.push('registry.json');
    for (const { name, current, expected } of readmes) {
      if (current !== expected) stale.push(name);
    }
    if (stale.length) {
      console.error(`Out of date: ${stale.join(', ')}. Run \`npm run registry\` to sync.`);
      process.exit(1);
    }
    console.log(`registry.json and both README catalogs are in sync (${registry.plugins.length} plugin(s)).`);
  } else {
    writeFileSync(registryPath, expectedRegistry);
    for (const { path, expected } of readmes) writeFileSync(path, expected);
    console.log(`Updated registry.json and both README catalogs (${registry.plugins.length} plugin(s)).`);
  }
}
