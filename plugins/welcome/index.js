// Reference Homecraft plugin: bilingual greeting badge in the top-left corner.
export default {
  setup(host, options = {}) {
    const en = typeof options.en === 'string' && options.en.trim() ? options.en.trim() : 'Welcome to my island';
    const zh = typeof options.zh === 'string' && options.zh.trim() ? options.zh.trim() : '欢迎来到我的小岛';
    const dismissible = options.dismissible !== false;

    host.ui.addStyle(`
      .hc-welcome-badge {
        position: fixed;
        top: calc(max(16px, env(safe-area-inset-top)) + 56px);
        right: max(16px, env(safe-area-inset-right));
        z-index: 9;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        max-width: min(320px, calc(100vw - 32px));
        padding: 8px 12px;
        font: 600 14px/1.35 var(--text);
        color: var(--ink);
        background: var(--gui);
        box-shadow: 0 0 0 2px var(--line), inset 2px 2px 0 var(--gui-light), inset -2px -2px 0 var(--gui-shade);
        pointer-events: auto;
      }
      .hc-welcome-badge span {
        overflow-wrap: anywhere;
      }
      .hc-welcome-badge button {
        flex: none;
        width: 24px;
        height: 24px;
        padding: 0;
        border: 0;
        background: var(--btn);
        color: #fff;
        font: 600 16px/1 var(--text);
        box-shadow: 0 0 0 1px var(--line);
      }
      .hc-welcome-badge button:hover {
        background: var(--btn-hover);
      }
      @media (max-width: 720px), (max-height: 520px) {
        body.reading .hc-welcome-badge { visibility: hidden; }
        .hc-welcome-badge {
          top: calc(max(12px, env(safe-area-inset-top)) + 52px);
          right: max(12px, env(safe-area-inset-right));
          max-width: calc(100vw - 24px);
          font-size: 13px;
          padding: 6px 10px;
        }
      }
    `);

    const box = document.createElement('aside');
    box.className = 'hc-welcome-badge';
    box.setAttribute('role', 'status');
    const text = document.createElement('span');
    box.append(text);

    let closeBtn = null;
    if (dismissible) {
      closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => { box.hidden = true; }, { signal: host.signal });
      box.append(closeBtn);
    }

    const render = () => {
      text.textContent = host.t(zh, en);
      if (closeBtn) closeBtn.setAttribute('aria-label', host.t('关闭欢迎语', 'Dismiss greeting'));
    };

    render();
    host.ui.mount(box);
    host.events.on('lang', render);
    host.expose({ el: box, show: () => { box.hidden = false; }, hide: () => { box.hidden = true; } });
  },
};
