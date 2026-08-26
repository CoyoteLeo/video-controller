(() => {
  const VC = (globalThis.__videoController ??= {});

  let toastEl = null;
  let toastTimer = null;

  const showToast = (text) => {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = [
        'position:fixed',
        'top:20px',
        'left:50%',
        'transform:translateX(-50%)',
        'padding:8px 14px',
        'background:rgba(0,0,0,0.72)',
        'color:#fff',
        'font:600 14px/1.2 -apple-system,system-ui,sans-serif',
        'border-radius:6px',
        'z-index:2147483647',
        'pointer-events:none',
        'transition:opacity 0.2s',
      ].join(';');
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.style.opacity = '0';
    }, 900);
  };

  VC.panel = { showToast };
})();
