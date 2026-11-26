#!/usr/bin/env node
// End-to-end Playwright test for a plugin against a real Homecraft checkout.
// Measures draw calls / triangles vs baseline, checks desktop & mobile in EN & ZH,
// asserts 0 page errors, and writes screenshots to tools/.check/<id>/.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectPlugin, validId } from './schema.mjs';
import { addPlugin } from './cli.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function resolveHomecraft(explicit) {
  const candidates = [explicit, process.env.HOMECRAFT_DIR, resolve(REPO_ROOT, '../homecraft')].filter(Boolean);
  for (const dir of candidates) {
    const full = resolve(dir);
    if (existsSync(join(full, 'engine/plugins.js'))) return realpathSync(full);
  }
  throw Error('Could not find a Homecraft checkout with engine/plugins.js. Pass --homecraft <dir> or set HOMECRAFT_DIR.');
}

async function loadPlaywright(homecraftDir) {
  const candidates = [
    join(REPO_ROOT, 'node_modules/playwright/index.mjs'),
    join(homecraftDir, 'node_modules/playwright/index.mjs'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return import(pathToFileURL(p).href);
  }
  return import('playwright');
}

function copyTemplateSite(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const item of ['index.html', '_headers', 'home.config.js', 'homecraft.json', 'world', 'assets', 'engine', 'vendor']) {
    const from = join(src, item);
    if (existsSync(from)) cpSync(from, join(dest, item), { recursive: true });
  }
}

function serveDir(dir) {
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    let file = resolve(dir, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file.startsWith(resolve(dir) + sep) && file !== resolve(dir)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(done => { server.closeAllConnections(); server.close(done); }),
  })));
}

function defaultOptionsFor(manifest) {
  const opts = {};
  for (const [key, field] of Object.entries(manifest.config || {})) {
    if (field.default !== undefined) opts[key] = field.default;
  }
  return opts;
}

async function bootAndMeasure(browser, url, { viewport, isMobile = false, screenshot = null }) {
  const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const target = route.request().url();
    if (target.startsWith(new URL(url).origin) || target.startsWith('data:') || target.startsWith('blob:')) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__home && !window.__home.rig.introActive, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => ({
    stats: __home.stats(),
    plugins: __home.plugins.status(),
  }));
  if (screenshot) await page.screenshot({ path: screenshot });
  await context.close();
  return { ...result, errors };
}

export async function testPlugin({ id, homecraftDir, markdown = false }) {
  if (!validId(id)) throw Error(`Invalid plugin ID: "${id}"`);
  const pluginDir = join(REPO_ROOT, 'plugins', id);
  const inspected = inspectPlugin(pluginDir, id);
  if (!inspected.valid) throw Error(`Validation failed: ${inspected.errors.join('; ')}`);
  if (inspected.manifest.mode === 'recipe') {
    const skipped = { id, mode: 'recipe', skipped: true, reason: 'Source recipes require manual core integration.' };
    console.log(markdown ? `ℹ️ \`${id}\` is a \`recipe\` plugin; automated host install test skipped.` : JSON.stringify(skipped, null, 2));
    return skipped;
  }

  const hc = resolveHomecraft(homecraftDir);
  const { chromium } = await loadPlaywright(hc);
  const work = mkdtempSync(join(tmpdir(), `homecraft-plugin-test-${id}-`));
  const outDir = join(REPO_ROOT, 'tools/.check', id);
  mkdirSync(outDir, { recursive: true });

  const site = join(work, 'site');
  copyTemplateSite(hc, site);
  const server = await serveDir(site);
  const launchOpts = process.env.CI ? {} : { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' };
  const browser = await chromium.launch(launchOpts);

  try {
    // 1. Baseline stats without plugin
    const baseline = await bootAndMeasure(browser, `${server.url}/?lang=en`, { viewport: { width: 1280, height: 800 } });
    assert.deepEqual(baseline.errors, [], 'Baseline site had page errors');

    // 2. Install plugin and enable in home.config.js
    addPlugin({ id, site, force: true, catalogRoot: REPO_ROOT });
    const opts = defaultOptionsFor(inspected.manifest);
    const entryCode = Object.keys(opts).length ? JSON.stringify({ id, ...opts }) : JSON.stringify(id);
    const cfgPath = join(site, 'home.config.js');
    const cfgSrc = readFileSync(cfgPath, 'utf8');
    const nextCfg = /plugins\s*:/.test(cfgSrc)
      ? cfgSrc.replace(/plugins\s*:\s*\[[^\]]*\]/, `plugins: [${entryCode}]`)
      : cfgSrc.replace(/badge\s*:/, `plugins: [${entryCode}],\n  badge:`);
    writeFileSync(cfgPath, nextCfg);

    // 3. Test desktop (EN + ZH) and mobile (ZH)
    const desktopEn = await bootAndMeasure(browser, `${server.url}/?lang=en`, {
      viewport: { width: 1280, height: 800 },
      screenshot: join(outDir, 'desktop-en.png'),
    });
    const desktopZh = await bootAndMeasure(browser, `${server.url}/?lang=zh`, {
      viewport: { width: 1280, height: 800 },
      screenshot: join(outDir, 'desktop-zh.png'),
    });
    const mobileZh = await bootAndMeasure(browser, `${server.url}/?lang=zh`, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      screenshot: join(outDir, 'mobile-zh.png'),
    });

    const allErrors = [...desktopEn.errors, ...desktopZh.errors, ...mobileZh.errors];
    assert.deepEqual(allErrors, [], `Plugin page errors: ${allErrors.join('; ')}`);
    for (const [label, run] of [['desktop-en', desktopEn], ['desktop-zh', desktopZh], ['mobile-zh', mobileZh]]) {
      const rec = run.plugins.find(p => p.id === id);
      assert(rec && rec.state === 'active', `${label}: expected plugin "${id}" active, got ${JSON.stringify(rec)}`);
      assert(run.stats.calls <= 60, `${label}: draw calls ${run.stats.calls} exceed budget 60`);
      assert(run.stats.triangles <= 200000, `${label}: triangles ${run.stats.triangles} exceed budget 200000`);
    }

    const report = {
      id,
      version: inspected.manifest.version,
      passed: true,
      baseline: { calls: baseline.stats.calls, triangles: baseline.stats.triangles },
      desktop: { calls: desktopEn.stats.calls, triangles: desktopEn.stats.triangles, deltaCalls: desktopEn.stats.calls - baseline.stats.calls, deltaTris: desktopEn.stats.triangles - baseline.stats.triangles },
      mobile: { calls: mobileZh.stats.calls, triangles: mobileZh.stats.triangles },
      screenshots: outDir,
    };

    if (markdown) {
      console.log([
        `### Browser Verification / 浏览器实测 (\`${id}\` v${report.version})`,
        '',
        '| Check | Result | Draw Calls (Budget <= 60) | Triangles (Budget <= 200k) |',
        '| --- | --- | --- | --- |',
        `| Baseline (no plugin) | ✅ | ${report.baseline.calls} | ${report.baseline.triangles} |`,
        `| Desktop (EN & ZH) | ✅ active, 0 errors | ${report.desktop.calls} (${report.desktop.deltaCalls >= 0 ? '+' : ''}${report.desktop.deltaCalls}) | ${report.desktop.triangles} (${report.desktop.deltaTris >= 0 ? '+' : ''}${report.desktop.deltaTris}) |`,
        `| Mobile (ZH) | ✅ active, 0 errors | ${report.mobile.calls} | ${report.mobile.triangles} |`,
      ].join('\n'));
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
    return report;
  } finally {
    await browser.close();
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const hcIdx = args.indexOf('--homecraft');
  const homecraftDir = hcIdx >= 0 ? args[hcIdx + 1] : null;
  const markdown = args.includes('--markdown');
  const id = args.find((a, i) => !a.startsWith('--') && i !== hcIdx + 1);
  if (!id) {
    console.error('Usage: node tools/test-plugin.mjs <plugin-id> [--homecraft <dir>] [--markdown]');
    process.exit(2);
  }
  await testPlugin({ id, homecraftDir, markdown });
}
