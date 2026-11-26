#!/usr/bin/env node
// Validates plugins (manifest, files, JS syntax, static risk scan) and optional
// PR file boundaries. Supports --markdown for GitHub PR review comments.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectPlugin, validId } from './schema.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pluginsRoot = join(root, 'plugins');

function checkJsSyntax(filePath) {
  try {
    execFileSync(process.execPath, ['--input-type=module', '--check'], {
      input: readFileSync(filePath),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return null;
  } catch (err) {
    return (err.stderr?.toString() || err.message).trim().split('\n').slice(0, 3).join(' ');
  }
}

export function classifyPrFiles(paths) {
  const pluginIds = new Set();
  const nonPlugin = [];
  for (const p of paths) {
    const m = p.match(/^plugins\/([^/]+)\//);
    if (m) pluginIds.add(m[1]);
    else nonPlugin.push(p);
  }
  const allowedGenerated = new Set(['registry.json', 'README.md', 'README.en.md']);
  const unexpected = nonPlugin.filter(p => !allowedGenerated.has(p));
  return {
    isPluginPr: pluginIds.size > 0,
    pluginIds: [...pluginIds].sort(),
    unexpected,
  };
}

export function validatePlugins(ids, baseDir = root) {
  const dir = join(baseDir, 'plugins');
  const targets = ids.length
    ? ids
    : (existsSync(dir) ? readdirSync(dir).filter(n => !n.startsWith('.') && statSync(join(dir, n)).isDirectory()).sort() : []);

  const results = [];
  for (const id of targets) {
    if (!validId(id)) {
      results.push({ id, valid: false, errors: [`Invalid plugin directory name: "${id}"`], totalBytes: 0, files: [], risk: { blockers: [], notices: [], externalUrls: [] } });
      continue;
    }
    const pluginDir = join(dir, id);
    if (!existsSync(pluginDir)) {
      results.push({ id, valid: false, errors: [`Plugin folder not found: plugins/${id}`], totalBytes: 0, files: [], risk: { blockers: [], notices: [], externalUrls: [] } });
      continue;
    }
    const inspected = inspectPlugin(pluginDir, id);
    for (const file of inspected.files) {
      if (!/\.m?js$/.test(file.rel)) continue;
      const syntaxError = checkJsSyntax(file.full);
      if (syntaxError) inspected.errors.push(`Syntax error in ${file.rel}: ${syntaxError}`);
    }
    inspected.valid = inspected.errors.length === 0;
    results.push({ id, ...inspected });
  }
  return results;
}

export function formatMarkdown(results, prCheck = null) {
  const lines = ['### Plugin Validation Report / 插件校验报告', ''];
  if (prCheck) {
    if (prCheck.pluginIds.length > 1) {
      lines.push(`- ❌ **PR Scope**: Keep one plugin per pull request (found: ${prCheck.pluginIds.join(', ')})`);
    }
    if (prCheck.unexpected.length) {
      lines.push(`- ❌ **PR Scope**: Plugin PRs should only modify \`plugins/<id>/\`, \`registry.json\`, \`README.md\`, and \`README.en.md\` (unexpected: ${prCheck.unexpected.join(', ')})`);
    }
  }
  for (const r of results) {
    const badge = r.valid ? '✅' : '❌';
    const kb = (r.totalBytes / 1024).toFixed(1);
    const meta = r.manifest ? `v${r.manifest.version} · \`${r.manifest.mode}\` · minEngine \`${r.manifest.minEngine}\` · ${r.files.length} files (${kb} KiB)` : '';
    lines.push(`#### ${badge} \`${r.id}\` ${meta}`);
    if (r.errors.length) {
      lines.push('', '**Errors**');
      for (const e of r.errors) lines.push(`- ❌ ${e}`);
    }
    if (r.risk.notices.length || r.risk.externalUrls.length) {
      lines.push('', '**Reviewer Risk Checklist (Static Scan)**');
      for (const n of r.risk.notices) lines.push(`- ⚠️ ${n}`);
      if (r.risk.externalUrls.length) {
        lines.push(`- 🌐 External URLs found: ${r.risk.externalUrls.map(u => `\`${u}\``).join(', ')}`);
      }
    } else if (r.valid) {
      lines.push('', '- 🟢 No external URLs, network APIs, or browser storage calls detected.');
    }
    lines.push('');
  }
  return lines.join('\n');
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const markdown = args.includes('--markdown');
  const prBaseIdx = args.indexOf('--pr-base');
  const prBase = prBaseIdx >= 0 ? args[prBaseIdx + 1] : null;
  const positional = args.filter((a, i) => !a.startsWith('--') && i !== prBaseIdx + 1);

  let prCheck = null;
  let ids = positional;
  if (prBase) {
    const changed = execFileSync('git', ['diff', '--name-only', '-z', prBase, 'HEAD'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    prCheck = classifyPrFiles(changed);
    if (prCheck.isPluginPr) {
      ids = prCheck.pluginIds;
    }
  }

  const results = validatePlugins(ids, root);
  const prErrors = prCheck?.isPluginPr && (prCheck.pluginIds.length > 1 || prCheck.unexpected.length > 0);
  const ok = !prErrors && results.every(r => r.valid);

  if (markdown) {
    console.log(formatMarkdown(results, prCheck?.isPluginPr ? prCheck : null));
  } else {
    for (const r of results) {
      const kb = (r.totalBytes / 1024).toFixed(1);
      console.log(`${r.valid ? 'PASS' : 'FAIL'} ${r.id} (${r.files.length} files, ${kb} KiB)`);
      for (const e of r.errors) console.log(`  error: ${e}`);
      for (const n of r.risk.notices) console.log(`  notice: ${n}`);
    }
    if (prErrors) {
      if (prCheck.pluginIds.length > 1) console.error(`FAIL PR scope: multiple plugins touched (${prCheck.pluginIds.join(', ')})`);
      if (prCheck.unexpected.length) console.error(`FAIL PR scope: unexpected files (${prCheck.unexpected.join(', ')})`);
    }
  }
  if (!ok) process.exit(1);
}
