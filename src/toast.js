(() => {
  const VC = (globalThis.__videoController ??= {});

  let host = null;
  let el = null;
  let timer = null;

  // The only thing that still renders in the page. Keyboard shortcuts fire while
  // the extension panel is closed, so they need feedback that does not depend on
  // it being open.
  const ensureHost = () => {
    if (host) return;
    host = document.createElement('div');
    host.id = '__video_controller_toast__';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .toast {
          position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
          padding: 8px 14px; background: rgba(0,0,0,0.72); color: #fff;
          font: 600 14px/1.2 -apple-system, system-ui, sans-serif;
          border-radius: 6px; opacity: 0; transition: opacity 0.2s;
        }
      </style>
      <div class="toast"></div>
    `;
    el = root.querySelector('.toast');
    document.documentElement.appendChild(host);
  };

  const showToast = (text) => {
    ensureHost();
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(timer);
    timer = setTimeout(() => { if (el) el.style.opacity = '0'; }, 900);
  };

  VC.toast = { showToast };
})();
