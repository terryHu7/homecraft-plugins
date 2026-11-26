#!/usr/bin/env node
// Zero-dependency installer CLI for Homecraft plugins.
// Run directly via: npx --yes github:terryHu7/homecraft-plugins <command>
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareSemver, inspectPlugin, validId, validSemver } from './schema.mjs';
import { buildRegistry } from './registry.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE_NAME = 'terryHu7/homecraft-plugins';

const HELP = `Homecraft Plugins CLI

Usage:
  homecraft-plugins list [--installed] [--site <dir>] [--json]
  homecraft-plugins search <query> [--json]
  homecraft-plugins info <id> [--json]
  homecraft-plugins add <id> [--site <dir>] [--force] [--json]
  homecraft-plugins remove <id> [--site <dir>] [--with-backend] [--json]

Options:
  --site <dir>      Target Homecraft site directory (default: current working directory)
  --installed       List plugins installed in the target site
  --force           Overwrite an already-installed plugin when updating
  --with-backend    Also remove backend/<id>/ when removing a plugin
  --json            Output machine-readable JSON
`;

function parseArgs(argv) {
  const positional = [];
  const flags = { site: process.cwd(), force: false, installed: false, withBackend: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--site' && argv[i + 1]) { flags.site = resolve(argv[++i]); }
    else if (a === '--force') flags.force = true;
    else if (a === '--installed') flags.installed = true;
    else if (a === '--with-backend') flags.withBackend = true;
    else if (a === '--json') flags.json = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else if (a.startsWith('--')) throw Error(`Unknown option: ${a}`);
    else positional.push(a);
  }
  return { command: positional[0] || 'help', target: positional[1] || '', flags };
}

function readSiteInfo(site) {
  const required = ['index.html', 'home.config.js', 'engine/manifest.json'];
  for (const file of required) {
    if (!existsSync(join(site, file))) {
      throw Error(`Target directory is not a Homecraft source folder (missing ${file}): ${site}`);
    }
  }
  const manifest = JSON.parse(readFileSync(join(site, 'engine/manifest.json'), 'utf8'));
  const hasHost = existsSync(join(site, 'engine/plugins.js'));
  return { site, engineVersion: manifest.version || '0.0.0', hasHost };
}

export function listInstalled(site) {
  const dir = join(site, 'world/plugins');
  if (!existsSync(dir)) return [];
  const installed = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (name.startsWith('.') || !statSync(full).isDirectory()) continue;
    let meta = {};
    try { meta = JSON.parse(readFileSync(join(full, 'plugin.json'), 'utf8')); } catch {}
    let source = null;
    try { source = JSON.parse(readFileSync(join(full, '.source.json'), 'utf8')); } catch {}
    installed.push({
      id: name,
      version: meta.version || source?.version || 'unknown',
      name: meta.name || { en: name, zh: name },
      hasBackend: existsSync(join(site, 'backend', name)),
      source: source?.source || 'local',
    });
  }
  return installed;
}

export function addPlugin({ id, site, force = false, catalogRoot = REPO_ROOT }) {
  if (!validId(id)) throw Error(`Invalid plugin ID: "${id}"`);
  const srcDir = join(catalogRoot, 'plugins', id);
  if (!existsSync(srcDir)) throw Error(`Plugin "${id}" was not found in the catalog.`);
  const inspected = inspectPlugin(srcDir, id);
  if (!inspected.valid) throw Error(`Plugin "${id}" failed validation: ${inspected.errors.join('; ')}`);

  const manifest = inspected.manifest;
  const info = readSiteInfo(site);
  if (manifest.mode === 'recipe') {
    throw Error(`Plugin "${id}" is a source recipe (modifies core files). Read plugins/${id}/README.md and apply its documented steps manually or with your coding agent.`);
  }
  if (!info.hasHost) {
    throw Error(
      `This Homecraft site (engine ${info.engineVersion}) does not have the plugin host yet. ` +
      `Run \`npm run update\` (or \`npx --yes https://github.com/terryHu7/homecraft/releases/latest/download/homecraft-updater.tgz\`) first.`,
    );
  }
  if (validSemver(info.engineVersion) && compareSemver(info.engineVersion, manifest.minEngine) < 0) {
    throw Error(
      `Plugin "${id}" requires Homecraft engine >= ${manifest.minEngine} (current: ${info.engineVersion}). Run \`npm run update\` first.`,
    );
  }

  const destFrontend = join(site, 'world/plugins', id);
  if (existsSync(destFrontend) && !force) {
    throw Error(`Plugin "${id}" is already installed at world/plugins/${id}. Re-run with --force to replace it.`);
  }
  if (existsSync(destFrontend)) rmSync(destFrontend, { recursive: true, force: true });
  mkdirSync(destFrontend, { recursive: true });

  const serverDirName = manifest.server || null;
  for (const name of readdirSync(srcDir)) {
    if (name === '.DS_Store' || name === serverDirName) continue;
    cpSync(join(srcDir, name), join(destFrontend, name), { recursive: true });
  }
  writeFileSync(
    join(destFrontend, '.source.json'),
    JSON.stringify({ id: manifest.id, version: manifest.version, source: SOURCE_NAME, installedAt: new Date().toISOString() }, null, 2) + '\n',
  );

  let backendPath = null;
  if (serverDirName) {
    const destBackend = join(site, 'backend', id);
    if (!existsSync(destBackend) || force) {
      if (existsSync(destBackend)) rmSync(destBackend, { recursive: true, force: true });
      mkdirSync(destBackend, { recursive: true });
      cpSync(join(srcDir, serverDirName), destBackend, { recursive: true });
    }
    backendPath = `backend/${id}`;
  }

  const configKeys = Object.entries(manifest.config || {});
  const requiredKeys = configKeys.filter(([, f]) => f.required).map(([k]) => k);
  const configSnippet = configKeys.length
    ? `{ id: '${id}', ${configKeys.map(([k, f]) => `${k}: ${JSON.stringify(f.default ?? '')}`).join(', ')} }`
    : `'${id}'`;

  return {
    action: 'added',
    id,
    version: manifest.version,
    frontendPath: `world/plugins/${id}`,
    backendPath,
    readme: `world/plugins/${id}/README.md`,
    agentGuide: `world/plugins/${id}/AGENTS.md`,
    requiredConfig: requiredKeys,
    configSnippet,
    nextSteps: [
      `Read world/plugins/${id}/AGENTS.md for AI installation, configuration, and verification instructions.`,
      `Add ${configSnippet} to the \`plugins\` array in home.config.js.${backendPath ? ` Backend files are in ${backendPath}/.` : ''}`,
      'Preview locally with `python3 tools/serve.py` and verify with `npm run check`.',
    ],
  };
}

export function removePlugin({ id, site, withBackend = false }) {
  if (!validId(id)) throw Error(`Invalid plugin ID: "${id}"`);
  const frontendDir = join(site, 'world/plugins', id);
  const backendDir = join(site, 'backend', id);
  const hadFrontend = existsSync(frontendDir);
  const hadBackend = existsSync(backendDir);
  if (!hadFrontend && !(withBackend && hadBackend)) {
    throw Error(`Plugin "${id}" is not installed in ${site}.`);
  }
  if (hadFrontend) rmSync(frontendDir, { recursive: true, force: true });
  let removedBackend = false;
  if (withBackend && hadBackend) {
    rmSync(backendDir, { recursive: true, force: true });
    removedBackend = true;
  }
  return {
    action: 'removed',
    id,
    removedFrontend: hadFrontend,
    removedBackend,
    remainingBackend: !removedBackend && hadBackend ? `backend/${id}` : null,
    nextSteps: [
      `Remove '${id}' from the \`plugins\` array in home.config.js.`,
      ...(!removedBackend && hadBackend ? [`Backend directory backend/${id}/ was preserved; delete it or re-run with --with-backend if no longer needed.`] : []),
    ],
  };
}

export function runCli(argv = process.argv.slice(2), catalogRoot = REPO_ROOT) {
  const { command, target, flags } = parseArgs(argv);
  if (flags.help || command === 'help') return { help: HELP };

  if (command === 'list') {
    if (flags.installed) return { installed: listInstalled(flags.site) };
    return { plugins: buildRegistry(catalogRoot).plugins };
  }
  if (command === 'search') {
    const q = target.toLowerCase();
    const plugins = buildRegistry(catalogRoot).plugins.filter(p =>
      `${p.id} ${p.name.en} ${p.name.zh} ${p.description.en} ${p.description.zh} ${p.category} ${p.author}`.toLowerCase().includes(q),
    );
    return { query: target, plugins };
  }
  if (command === 'info') {
    if (!validId(target)) throw Error(`Invalid plugin ID: "${target}"`);
    const plugin = buildRegistry(catalogRoot).plugins.find(p => p.id === target);
    if (!plugin) throw Error(`Plugin "${target}" not found.`);
    const readme = readFileSync(join(catalogRoot, plugin.path, 'README.md'), 'utf8');
    const agentGuide = readFileSync(join(catalogRoot, plugin.path, 'AGENTS.md'), 'utf8');
    return { plugin, readme, agentGuide };
  }
  if (command === 'add') return addPlugin({ id: target, site: flags.site, force: flags.force, catalogRoot });
  if (command === 'remove') return removePlugin({ id: target, site: flags.site, withBackend: flags.withBackend });
  throw Error(`Unknown command: "${command}". Run with --help for usage.`);
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  const json = process.argv.includes('--json');
  try {
    const result = runCli(process.argv.slice(2));
    if (result.help) {
      console.log(result.help);
    } else if (json) {
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    } else if (result.plugins) {
      if (!result.plugins.length) console.log('No matching plugins.');
      for (const p of result.plugins) {
        console.log(`${p.id} (v${p.version}, ${p.mode}) — ${p.name.en} / ${p.name.zh}`);
        console.log(`  ${p.description.en}`);
      }
    } else if (result.installed) {
      if (!result.installed.length) console.log('No plugins installed.');
      for (const p of result.installed) console.log(`${p.id} (v${p.version})${p.hasBackend ? ' [+backend]' : ''}`);
    } else if (result.plugin) {
      const p = result.plugin;
      console.log(`${p.id} v${p.version} (${p.mode}, minEngine >= ${p.minEngine}) by ${p.author}`);
      console.log(`${p.name.en} / ${p.name.zh}`);
      console.log(`AI Guide: ${p.agentGuide}\n`);
      console.log(result.readme);
    } else if (result.nextSteps) {
      console.log(`${result.action === 'added' ? 'Installed' : 'Removed'} "${result.id}"${result.version ? ` v${result.version}` : ''}.`);
      for (const step of result.nextSteps) console.log(`  - ${step}`);
    }
  } catch (err) {
    if (json) console.error(JSON.stringify({ ok: false, error: err.message }));
    else console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
