// Floating action button (F-1.2): appears near the current text selection
// like Medium's highlight bar. Lives in a tiny shadow root of its own so
// host CSS can't restyle it.

import fabCss from './popover/popover.css?inline';

const HOST_ID = 'hermes-fab-host';

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let btn: HTMLButtonElement | null = null;
let onClickCb: (() => void) | null = null;

function ensureHost(): { btn: HTMLButtonElement; host: HTMLElement } {
  if (host && btn) return { btn, host };
  host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.position = 'fixed';
    host.style.zIndex = '2147483646';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '0';
    host.style.height = '0';
    document.documentElement.appendChild(host);
  }
  shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (!shadow.querySelector('style')) {
    const style = document.createElement('style');
    style.textContent = fabCss;
    shadow.appendChild(style);
  }
  btn = shadow.querySelector('button.hermes-fab');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hermes-fab';
    btn.textContent = 'Hermes';
    btn.style.display = 'none';
    btn.addEventListener('mousedown', (e) => {
      // Prevent collapsing the selection before we read it.
      e.preventDefault();
    });
    btn.addEventListener('click', () => onClickCb?.());
    shadow.appendChild(btn);
  }
  return { btn, host };
}

export function setFloatingButtonHandler(cb: () => void): void {
  onClickCb = cb;
}

export function showFloatingButton(rect: DOMRect): void {
  const { btn } = ensureHost();
  btn.style.display = '';
  const top = Math.max(8, rect.top - 36);
  const left = Math.min(
    window.innerWidth - 100,
    Math.max(8, rect.left + rect.width / 2 - 40),
  );
  btn.style.top = `${top}px`;
  btn.style.left = `${left}px`;
}

export function hideFloatingButton(): void {
  if (btn) btn.style.display = 'none';
}

export function destroyFloatingButton(): void {
  host?.remove();
  host = null;
  shadow = null;
  btn = null;
  onClickCb = null;
}
