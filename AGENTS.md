# Homecraft Plugins — Agent Guide

Requires Node.js 22+. Read `registry.json` to discover plugins, and always read a plugin's own `AGENTS.md` before installing or customizing it.

## Documentation Separation Rule

Every plugin keeps human documentation and AI instructions separate:

- `README.md` — concise, human-facing overview (scope, screenshots, options, link to `AGENTS.md`).
- `AGENTS.md` — required, Agent-facing integration specification for the target site's coding agent (preflight checks, exact install commands, `home.config.js` options, layout/coordinate integration, backend deployment steps if any, common follow-up customizations, browser verification steps, and clean uninstall).

## Installing a plugin into a Homecraft site

1. Inspect the plugin first (`npx --yes github:terryHu7/homecraft-plugins info <id> --json`, or read `plugins/<id>/plugin.json` and `plugins/<id>/AGENTS.md`).
2. Check whether the target site has `engine/plugins.js` and satisfies `minEngine` in `engine/manifest.json`.
   - If the target site is an older fork without `engine/plugins.js`, upgrade `engine/` first following `engine/UPDATING.md` (`npm run update`, or `npx --yes https://github.com/terryHu7/homecraft/releases/latest/download/homecraft-updater.tgz`). Do not overwrite `world/`, `index.html`, `home.config.js`, or `tools/build.sh`.
3. For `"mode": "standard"` plugins:
   - Run `npx --yes github:terryHu7/homecraft-plugins add <id> --site "<site-dir>" --json` (or `node tools/cli.mjs add <id> --site "<site-dir>" --json` from a local checkout).
   - Frontend files copy to `world/plugins/<id>/`; optional backend code copies to `backend/<id>/`.
   - Read `<site>/world/plugins/<id>/AGENTS.md` and follow its configuration, placement, backend, and verification instructions.
   - Update the `plugins` array in `<site>/home.config.js` according to the user's preferences (never fabricate user credentials, private URLs, or personal metadata).
   - Do not modify `engine/` or `world/build.js` for standard plugins.
4. For `"mode": "recipe"` plugins:
   - Inform the user that a recipe modifies core files and may introduce conflicts during future `npm run update` runs. Proceed only after confirmation and follow `plugins/<id>/AGENTS.md`.
5. Verify in the target site:
   - Start preview (`python3 tools/serve.py`) and run `npm run check` (or verify desktop and mobile viewports in enabled languages, ensuring draw calls `<= 60`, triangles `<= 200,000`, and zero page errors).
   - Remind the user to commit and redeploy through their hosting setup.

## Authoring and submitting a plugin

See `docs/plugins.md` in `terryHu7/homecraft` for the complete Plugin Host API (`build(ctx, options)` and `setup(host, options)`).

1. Develop locally inside a Homecraft site under `world/plugins/<id>/` and enable it in `home.config.js` for live reload.
2. Copy the finished plugin into `plugins/<id>/` in your fork of `homecraft-plugins`. Required files (validated by CI):
   - `plugin.json`: valid manifest (`id` matches folder name, semver `version`, `mode`, `minEngine`, bilingual `name` and `description`, `author`, `license`, `category`, `entry`, `preview` image path or `{ en, zh }` image paths shown in the README catalog, optional `server`, `permissions`, `config`).
   - `index.js`: ES module exporting `default { build?, setup? }` (for `standard` mode).
   - `README.md`: concise human-facing overview, preview image, options summary, and link to `AGENTS.md`.
   - `AGENTS.md`: concise English execution guide written specifically for the future user's AI agent (see `plugins/welcome/AGENTS.md` as the reference template). Cover preflight, install command, configuration options, how to integrate with existing `world/layout.js` or `homecraft.json` if relevant, backend deployment if `server` is present, common follow-up customizations, browser verification checklist, and uninstall steps.
   - `LICENSE`: open-source license text.
3. Keep all dependencies self-contained inside the plugin folder. Never use `eval`, `new Function`, or load executable JavaScript from external URLs.
4. Run validation and sync generated files:
   ```sh
   npm run registry
   npm run check
   npm run test:plugin -- <id> --homecraft /path/to/homecraft
   ```
5. Open one pull request per plugin against `main`, changing only `plugins/<id>/`, `registry.json`, `README.md`, and `README.en.md`.
