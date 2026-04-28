// Cuponomia-style floating panel: pre-mounts an iframe pointing at the
// popup React app, then toggles visibility. Pre-mounting eliminates the
// load flash on first toggle.

const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 600;
const SIDE_OFFSET = 12;
const TOP_OFFSET = 12;

let host: HTMLDivElement | null = null;
let frame: HTMLIFrameElement | null = null;
let visible = false;
let listenersBound = false;

function anchorPosition(): { top: number; right: number; height: number; width: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(PANEL_WIDTH, vw - SIDE_OFFSET * 2);
  const height = Math.min(PANEL_HEIGHT, vh - TOP_OFFSET * 2);
  const right = SIDE_OFFSET;
  const top = TOP_OFFSET;
  return { top, right, width, height };
}

function applyAnchor(): void {
  if (!host) return;
  const a = anchorPosition();
  host.style.top = `${a.top}px`;
  host.style.right = `${a.right}px`;
  host.style.width = `${a.width}px`;
  host.style.height = `${a.height}px`;
}

function ensureMounted(): { host: HTMLDivElement; frame: HTMLIFrameElement } {
  if (host && frame) return { host, frame };

  const el = document.createElement('div');
  el.id = 'hermes-panel-host';
  el.setAttribute('data-hermes-ignore-selection', 'true');
  Object.assign(el.style, {
    position: 'fixed',
    zIndex: '2147483646',
    borderRadius: '16px',
    overflow: 'hidden',
    boxShadow:
      '0 2px 4px rgba(0,0,0,0.4), 0 18px 48px rgba(0,0,0,0.5)',
    background: 'transparent',
    pointerEvents: 'none',
    isolation: 'isolate',
    opacity: '0',
    transform: 'translateY(-4px)',
    transition: 'opacity 0.12s ease, transform 0.12s ease',
    visibility: 'hidden',
  } as Partial<CSSStyleDeclaration>);

  const f = document.createElement('iframe');
  f.src = chrome.runtime.getURL('src/popup/index.html');
  f.allow = 'autoplay; clipboard-read; clipboard-write';
  Object.assign(f.style, {
    width: '100%',
    height: '100%',
    border: '0',
    display: 'block',
    background: 'transparent',
    colorScheme: 'normal',
  } as Partial<CSSStyleDeclaration>);
  f.setAttribute('title', 'Hermes');
  f.setAttribute('allowtransparency', 'true');

  el.appendChild(f);
  document.body.appendChild(el);
  host = el;
  frame = f;
  applyAnchor();
  return { host: el, frame: f };
}

function onDocumentMouseDown(e: MouseEvent): void {
  if (!host || !visible) return;
  const target = e.target as Node;
  if (host.contains(target)) return;
  hidePanel();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && visible) hidePanel();
}

function onResize(): void {
  applyAnchor();
}

function bindListeners(): void {
  if (listenersBound) return;
  document.addEventListener('mousedown', onDocumentMouseDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  listenersBound = true;
}

function unbindListeners(): void {
  if (!listenersBound) return;
  document.removeEventListener('mousedown', onDocumentMouseDown, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', onResize);
  listenersBound = false;
}

export function showPanel(): void {
  const { host: el } = ensureMounted();
  applyAnchor();
  visible = true;
  el.style.visibility = 'visible';
  el.style.pointerEvents = 'auto';
  // Defer fade-in to next frame so the transition has something to animate.
  requestAnimationFrame(() => {
    if (!host) return;
    host.style.opacity = '1';
    host.style.transform = 'translateY(0)';
  });
  // Defer click-outside binding so the click that opened the panel doesn't
  // immediately close it.
  setTimeout(bindListeners, 0);
}

export function hidePanel(): void {
  if (!host) return;
  visible = false;
  host.style.opacity = '0';
  host.style.transform = 'translateY(-4px)';
  host.style.pointerEvents = 'none';
  // Hide after the fade so it doesn't catch focus/clicks while invisible.
  setTimeout(() => {
    if (!visible && host) host.style.visibility = 'hidden';
  }, 140);
  unbindListeners();
}

export function togglePanel(): void {
  if (visible) hidePanel();
  else showPanel();
}

export function isPanelOpen(): boolean {
  return visible;
}

// Allow the framed popup to ask the host to close it.
window.addEventListener('message', (e) => {
  if (e.source !== frame?.contentWindow) return;
  const data = e.data as { kind?: string } | null;
  if (data?.kind === 'hermes-panel-close') hidePanel();
});

// Pre-mount the iframe ahead of the first click so its content is already
// loaded when the panel opens — no flash, no glitch.
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(() => ensureMounted(), 0);
} else {
  window.addEventListener('DOMContentLoaded', () => ensureMounted(), { once: true });
}
