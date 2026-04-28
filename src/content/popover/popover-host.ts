// Mounts the capture popover into a Shadow DOM so host-page CSS cannot leak
// in (U-3 polish) and our styles cannot leak out. Anchors to a viewport
// rectangle and auto-flips above/below per U-1.

import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { Popover, type PopoverProps } from './Popover';
import popoverCss from './popover.css?inline';

const HOST_ID = 'hermes-popover-host';

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let mount: HTMLDivElement | null = null;
let root: Root | null = null;

function ensureHost(): { mount: HTMLDivElement; shadow: ShadowRoot } {
  if (mount && shadow) return { mount, shadow };
  host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.position = 'fixed';
    host.style.zIndex = '2147483647';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '0';
    host.style.height = '0';
    document.documentElement.appendChild(host);
  }
  shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (!shadow.querySelector('style')) {
    const style = document.createElement('style');
    style.textContent = popoverCss;
    shadow.appendChild(style);
  }
  mount = shadow.querySelector('div.hermes-mount');
  if (!mount) {
    mount = document.createElement('div');
    mount.className = 'hermes-mount';
    shadow.appendChild(mount);
  }
  return { mount, shadow };
}

export function showPopover(props: PopoverProps): void {
  const { mount: m } = ensureHost();
  if (!root) root = createRoot(m);
  // Key by capturedAt so each new capture forces a fresh mount. Without
  // this, a second capture triggered while a previous run was streaming in
  // toast mode would re-use the old component instance — its `mode` state
  // would still be 'toast' from the first run, so the new mode picker
  // would never render and the second capture appeared lost.
  root.render(createElement(Popover, { ...props, key: props.payload.capturedAt }));
}

export function hidePopover(): void {
  if (root) root.render(createElement('div'));
}

export function destroyPopover(): void {
  if (root) {
    root.unmount();
    root = null;
  }
  host?.remove();
  host = null;
  shadow = null;
  mount = null;
}
