# Welcome (Example) (`welcome`) — Agent Guide

Minimal example plugin for testing the Homecraft plugin host, CLI, and CI (not a real feature plugin). Read this file before installing, configuring, or removing `welcome` in a Homecraft site.

## 1. Preflight

- Target site must include `engine/plugins.js` and `engine/manifest.json` version `>= 0.3.0`.
- If the site is an older fork without `engine/plugins.js`, upgrade `engine/` first using `npm run update` (or the standalone updater in `engine/UPDATING.md`). Do not edit `tools/build.sh` or `index.html`.
- This plugin runs entirely client-side with zero external requests and no backend directory.

## 2. Install

Run from the target Homecraft site root:

```sh
npx --yes github:terryHu7/homecraft-plugins add welcome --json
```

Files install into `world/plugins/welcome/`.

## 3. Configure `home.config.js`

Add an entry to the `plugins` array in `home.config.js`:

```js
plugins: [
  { id: 'welcome', en: 'Welcome to my island', zh: '欢迎来到我的小岛', dismissible: true },
],
```

- If the user provided custom greeting text, use their exact wording.
- If the user did not specify custom text, keep the defaults or ask for their preferred English and Chinese lines.
- Check `languages` in `home.config.js`: for single-language sites (`['zh']` or `['en']`), only that language needs customization.
- Do not modify `engine/` or `world/build.js`.

## 4. Common Follow-up Customizations

- **Change position or styling**: edit the injected CSS inside `world/plugins/welcome/index.js` (`host.ui.addStyle(...)`). Keep clear of the top-left Portal button, top-right `#corner` switches, bottom `#hotbar`, and `#minimap` on both desktop and mobile (`390×844`).
- **Hide the close button**: set `dismissible: false` in `home.config.js`.
- **Temporarily disable**: set `enabled: false` on the `welcome` entry in `home.config.js`.

## 5. Verification

1. Preview locally (`python3 tools/serve.py`) and run `npm run check`.
2. Verify in desktop (`1280×800`) and mobile (`390×844`) viewports in each enabled language (`/?lang=en`, `/?lang=zh`):
   - `[data-plugin="welcome"]` is visible below the top-right controls without overlapping HUD buttons.
   - `__home.plugins.status()` reports `{ id: 'welcome', state: 'active' }`.
   - Clicking `×` hides the badge when `dismissible: true`.
   - Zero console/page errors; draw calls `<= 60` and triangles `<= 200,000`.
3. Remind the user to commit and redeploy through their hosting setup.

## 6. Remove

```sh
npx --yes github:terryHu7/homecraft-plugins remove welcome --json
```

Then delete the `'welcome'` / `{ id: 'welcome', ... }` entry from `home.config.js`.
