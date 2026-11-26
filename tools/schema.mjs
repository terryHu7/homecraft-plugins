// Manifest validation and static risk scanning for homecraft-plugins.
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const MODES = ['standard', 'recipe'];
export const CATEGORIES = ['ui', 'world', 'social', 'portal', 'media', 'theme', 'tool'];
export const MAX_FILES = 100;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

export const validId = id =>
  typeof id === 'string' && id.length <= 60 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id);

export const validSemver = v =>
  typeof v === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v);

export function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = v => typeof v === 'string' && v.trim().length > 0;
const isSafeRelPath = p =>
  typeof p === 'string' && p.length > 0 && p.length < 180 &&
  /^[A-Za-z0-9_./-]+$/.test(p) && !p.startsWith('/') &&
  p.split('/').every(seg => seg && seg !== '.' && seg !== '..' && !seg.startsWith('.'));
const IMAGE_EXT = /\.(webp|png|jpe?g|gif)$/i;
const isSafeImagePath = p => isSafeRelPath(p) && IMAGE_EXT.test(p);

export function previewPaths(preview) {
  if (typeof preview === 'string') return isSafeRelPath(preview) ? [preview] : [];
  if (isObj(preview)) {
    const out = [];
    for (const key of ['en', 'zh']) {
      if (isSafeRelPath(preview[key]) && !out.includes(preview[key])) out.push(preview[key]);
    }
    return out;
  }
  return [];
}

function isValidPreview(preview) {
  if (typeof preview === 'string') return isSafeImagePath(preview);
  return isObj(preview) && isSafeImagePath(preview.en) && isSafeImagePath(preview.zh);
}

export function validateManifest(manifest, expectedId = null) {
  const errors = [];
  if (!isObj(manifest)) return ['plugin.json must be a JSON object'];
  if (!validId(manifest.id)) errors.push('id must be lowercase kebab-case (e.g. multiplayer)');
  if (expectedId && manifest.id !== expectedId) errors.push(`id "${manifest.id}" must match folder name "${expectedId}"`);
  if (!validSemver(manifest.version)) errors.push('version must use semver (major.minor.patch)');
  const mode = manifest.mode ?? 'standard';
  if (!MODES.includes(mode)) errors.push(`mode must be one of: ${MODES.join(', ')}`);
  if (!validSemver(manifest.minEngine)) errors.push('minEngine must use semver (e.g. 0.2.0)');
  for (const key of ['name', 'description']) {
    if (!isObj(manifest[key]) || !isText(manifest[key].en) || !isText(manifest[key].zh)) {
      errors.push(`${key} must provide non-empty en and zh strings`);
    }
  }
  if (!isText(manifest.author)) errors.push('author is required');
  if (!isText(manifest.license)) errors.push('license is required');
  if (manifest.category !== undefined && !CATEGORIES.includes(manifest.category)) {
    errors.push(`category must be one of: ${CATEGORIES.join(', ')}`);
  }
  if (mode === 'standard') {
    const entry = manifest.entry ?? 'index.js';
    if (!isSafeRelPath(entry) || !entry.endsWith('.js')) errors.push('entry must be a safe relative .js path');
  }
  if (manifest.server !== undefined && (!isSafeRelPath(manifest.server) || manifest.server.endsWith('/'))) {
    errors.push('server must be a safe relative directory name (e.g. "server")');
  }
  if (!isValidPreview(manifest.preview)) {
    errors.push('preview is required and must be a safe relative image path (.webp/.png/.jpg/.gif) or { en, zh } image paths');
  }
  if (manifest.permissions !== undefined) {
    if (!Array.isArray(manifest.permissions) || manifest.permissions.some(p => !isText(p))) {
      errors.push('permissions must be an array of non-empty strings');
    }
  }
  if (manifest.config !== undefined) {
    if (!isObj(manifest.config)) {
      errors.push('config must be an object');
    } else {
      for (const [key, field] of Object.entries(manifest.config)) {
        if (!/^[a-zA-Z][A-Za-z0-9_]{0,39}$/.test(key)) errors.push(`invalid config key: ${key}`);
        if (!isObj(field) || !['string', 'number', 'boolean', 'array', 'object'].includes(field.type)) {
          errors.push(`config.${key}.type must be string, number, boolean, array, or object`);
        }
        if (field.description !== undefined && !isText(field.description)) {
          errors.push(`config.${key}.description must be a non-empty string`);
        }
      }
    }
  }
  return errors;
}

export function walkPluginFiles(dir) {
  const files = [];
  const errors = [];
  let totalBytes = 0;

  function walk(current) {
    for (const name of readdirSync(current).sort()) {
      if (name === '.DS_Store') continue;
      const full = join(current, name);
      const rel = relative(dir, full).split('\\').join('/');
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) { errors.push(`Symbolic links are not allowed: ${rel}`); continue; }
      if (name.startsWith('.')) { errors.push(`Hidden files are not allowed: ${rel}`); continue; }
      if (stat.isDirectory()) { walk(full); continue; }
      if (!stat.isFile()) { errors.push(`Unsupported file type: ${rel}`); continue; }
      if (!isSafeRelPath(rel)) { errors.push(`Unsafe filename: ${rel}`); continue; }
      if (stat.size > MAX_FILE_BYTES) errors.push(`File exceeds 2 MiB limit: ${rel} (${stat.size} bytes)`);
      totalBytes += stat.size;
      files.push({ rel, full, size: stat.size });
    }
  }

  walk(dir);
  if (files.length > MAX_FILES) errors.push(`Plugin exceeds ${MAX_FILES} file limit (${files.length} files)`);
  if (totalBytes > MAX_TOTAL_BYTES) errors.push(`Plugin exceeds 8 MiB total limit (${totalBytes} bytes)`);
  return { files, totalBytes, errors };
}

export function scanPluginRisk(dir, manifest, files) {
  const blockers = [];
  const notices = [];
  const externalUrls = new Set();
  const serverPrefix = manifest.server ? `${manifest.server}/` : null;

  for (const file of files) {
    if (!/\.(m?js|css|html)$/.test(file.rel)) continue;
    const isServer = Boolean(serverPrefix && file.rel.startsWith(serverPrefix));
    const scope = isServer ? 'server' : 'client';
    const src = readFileSync(file.full, 'utf8');

    // Hard blockers on client code: remote script execution or dynamic eval.
    if (!isServer) {
      if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(src)) {
        blockers.push(`${file.rel}: dynamic code execution (eval / new Function) is not allowed`);
      }
      if (/import\s*\(\s*['"`]https?:\/\//.test(src) || /<script[^>]+src\s*=\s*['"]https?:\/\//i.test(src)) {
        blockers.push(`${file.rel}: loading remote executable scripts from external URLs is not allowed`);
      }
    }

    // Reviewer risk notices (informational, not auto-reject).
    if (/\bfetch\s*\(|\bWebSocket\s*\(|\bEventSource\s*\(/.test(src)) {
      notices.push(`${file.rel} (${scope}): uses network APIs (fetch / WebSocket / EventSource)`);
    }
    if (/\blocalStorage\b|\bsessionStorage\b|\bdocument\.cookie\b/.test(src)) {
      notices.push(`${file.rel} (${scope}): accesses browser storage or cookies`);
    }
    if (!isServer && /@engine\/|\.\.\/engine\//.test(src)) {
      notices.push(`${file.rel} (client): imports directly from @engine/`);
    }
    for (const match of src.matchAll(/https?:\/\/[^\s'"`<>)]+/g)) {
      externalUrls.add(match[0]);
    }
  }

  return { blockers, notices, externalUrls: [...externalUrls].sort() };
}

export function inspectPlugin(pluginDir, expectedId) {
  const errors = [];
  const manifestPath = join(pluginDir, 'plugin.json');
  if (!existsSync(manifestPath)) {
    return { valid: false, errors: ['Missing plugin.json'], manifest: null, files: [], totalBytes: 0, risk: { blockers: [], notices: [], externalUrls: [] } };
  }
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch (e) { return { valid: false, errors: [`Invalid JSON in plugin.json: ${e.message}`], manifest: null, files: [], totalBytes: 0, risk: { blockers: [], notices: [], externalUrls: [] } }; }

  errors.push(...validateManifest(manifest, expectedId));
  for (const required of ['README.md', 'AGENTS.md', 'LICENSE']) {
    const reqPath = join(pluginDir, required);
    if (!existsSync(reqPath)) errors.push(`Missing required file: ${required}`);
    else if (!readFileSync(reqPath, 'utf8').trim()) errors.push(`Required file must not be empty: ${required}`);
  }
  const mode = manifest.mode ?? 'standard';
  if (mode === 'standard') {
    const entry = manifest.entry ?? 'index.js';
    if (!existsSync(join(pluginDir, entry))) errors.push(`Missing entry module: ${entry}`);
  }
  if (manifest.server && !existsSync(join(pluginDir, manifest.server))) {
    errors.push(`Declared server directory does not exist: ${manifest.server}`);
  }
  for (const rel of previewPaths(manifest.preview)) {
    if (!existsSync(join(pluginDir, rel))) {
      errors.push(`Declared preview image does not exist: ${rel}`);
    }
  }

  const walked = walkPluginFiles(pluginDir);
  errors.push(...walked.errors);
  const risk = scanPluginRisk(pluginDir, manifest, walked.files);
  errors.push(...risk.blockers);

  return {
    valid: errors.length === 0,
    errors,
    manifest: { mode, entry: manifest.entry ?? 'index.js', ...manifest },
    files: walked.files,
    totalBytes: walked.totalBytes,
    risk,
  };
}
