# Contributing a Plugin

Submit one plugin per pull request. Keep PR changes scoped to `plugins/<id>/`, `registry.json`, `README.md`, and `README.en.md`.

## Requirements

1. **Folder structure**: Create `plugins/<id>/` using a lowercase kebab-case ID (e.g. `plugins/multiplayer/`).
2. **Required files (human docs and AI docs separated)**:
   - `plugin.json` — metadata, `minEngine`, `mode` (`standard` or `recipe`), `preview` (relative image path such as `preview.webp`, or `{ "en": "...", "zh": "..." }` for bilingual previews displayed in the README catalog), `permissions`, and `config` schema.
   - `index.js` — client entry module exporting `default { build?, setup? }` (required for `standard` plugins; see [Homecraft docs/plugins.md](https://github.com/terryHu7/homecraft/blob/main/docs/plugins.md)).
   - `README.md` — concise human-facing overview (purpose, screenshots, options summary, link to `AGENTS.md`).
   - `AGENTS.md` — **required** Agent-facing integration specification: exact install/config steps, how to adapt to a site's `world/layout.js` or `homecraft.json` if needed, optional backend setup, common customization points, verification checklist, and uninstall steps (follow [plugins/welcome/AGENTS.md](plugins/welcome/AGENTS.md)).
   - `LICENSE` — open-source license file matching `plugin.json`.
   - Optional `server/` directory (declared via `"server": "server"` in `plugin.json`) for self-hosted backend services.
3. **Safety and performance**:
   - No `eval`, `new Function`, or loading remote JavaScript from external URLs.
   - No symlinks or hidden files; keep total plugin size under 8 MiB (2 MiB per file, at most 100 files).
   - Respect Homecraft's site performance budget (`<= 60` draw calls, `<= 200,000` triangles, no per-frame allocations) on desktop and mobile.
   - Degrade cleanly if an optional external service is unreachable.

## Local Checks Before Opening a PR

```sh
npm run registry
npm run check
npm run test:plugin -- <your-plugin-id> --homecraft ../homecraft
```

Use an English PR title in `type(scope): description` format, e.g. `feat(plugin): add multiplayer` or `fix(welcome): adjust mobile spacing`.
