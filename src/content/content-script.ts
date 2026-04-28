// Content script: owns the in-page UI for capture (F-1.2..F-1.6, U-1).
//   - Watches `selectionchange` and shows the floating action button
//   - Reacts to context-menu / hotkey messages from the SW
//   - Mounts the capture popover (mode picker + Mode B sub-selection)
//   - Sends the final capture payload to the SW for enrichment

import { makeLogger } from '@/lib/log';
import { extractSurroundingSentence } from '@/lib/text/sentence';
import { hasRequiredKeys, type Settings } from '@/types/settings';
import {
  hideFloatingButton,
  setFloatingButtonHandler,
  showFloatingButton,
} from './floating-button';
import { hidePopover, showPopover } from './popover/popover-host';
import type { CapturePayload } from '@/types/messages';
import type { CaptureMode, HighlightSpan } from '@/types/card';

const log = makeLogger('content');

// chrome.storage isn't reliably exposed to dynamically-imported content-script
// chunks under @crxjs's loader. The SW always has full storage privileges, so
// we route settings reads through it instead of touching chrome.storage here.
let settings: Settings | null = null;

async function refreshSettings(): Promise<void> {
  try {
    const reply = (await chrome.runtime.sendMessage({ kind: 'get-settings' })) as
      | { kind: 'settings'; settings: Settings }
      | undefined;
    if (reply?.kind === 'settings') settings = reply.settings;
  } catch (e) {
    log.warn('refreshSettings failed', e instanceof Error ? e.message : String(e));
  }
}

void refreshSettings();

interface CaptureTriggerMessage {
  kind: 'capture-trigger';
  via: 'context-menu' | 'hotkey' | 'floating-button';
  selectionText?: string;
}

chrome.runtime.onMessage.addListener((msg: CaptureTriggerMessage | { kind: 'settings-changed'; settings: Settings }) => {
  if ('kind' in msg && msg.kind === 'settings-changed') {
    settings = msg.settings;
    return;
  }
  if (msg.kind !== 'capture-trigger') return;
  triggerCapture(msg.via);
});

setFloatingButtonHandler(() => triggerCapture('floating-button'));

document.addEventListener('selectionchange', () => {
  if (!settings?.triggers.floatingButton) {
    hideFloatingButton();
    return;
  }
  const sel = window.getSelection();
  const text = sel?.toString().trim() ?? '';
  if (!text || !sel || sel.rangeCount === 0) {
    hideFloatingButton();
    return;
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    hideFloatingButton();
    return;
  }
  showFloatingButton(rect);
});

function getSelectionRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) return null;
  return r;
}

async function triggerCapture(via: CaptureTriggerMessage['via']) {
  // Always re-fetch settings via the SW before each capture so we don't act
  // on stale cache (settings can change between captures).
  await refreshSettings();
  const sel = window.getSelection();
  const selectionText = sel?.toString().trim() ?? '';
  if (!selectionText) {
    log.warn('capture triggered with empty selection', { via });
    return;
  }

  if (settings && !hasRequiredKeys(settings)) {
    chrome.runtime.sendMessage({ kind: 'open-options', reason: 'missing-keys' });
    return;
  }

  const anchorNode = sel?.anchorNode;
  const fullText = anchorNode?.textContent ?? selectionText;
  const offset =
    anchorNode && sel
      ? anchorNode.textContent?.indexOf(selectionText) ?? -1
      : -1;
  const rawContext = extractSurroundingSentence(fullText, selectionText, offset);

  const rect = getSelectionRect() ?? new DOMRect(window.innerWidth / 2, 100, 0, 0);

  const payload: CapturePayload = {
    selectionText,
    rawContext,
    pageUrl: location.href,
    pageTitle: document.title,
    capturedAt: Date.now(),
  };

  hideFloatingButton();
  showPopover({
    anchorRect: rect,
    payload,
    rememberLastMode: settings?.triggers.rememberLastMode ?? false,
    lastMode: settings?.triggers.lastMode,
    onClose: () => hidePopover(),
    onSubmit: (mode, opts) => submitCapture(payload, mode, opts),
  });
}

async function submitCapture(
  payload: CapturePayload,
  mode: CaptureMode,
  opts: { sentence?: string; termSpan?: HighlightSpan },
): Promise<string | null> {
  log.log('submit capture', { mode, urlLen: payload.pageUrl.length });
  const ack = (await chrome.runtime.sendMessage({
    kind: 'capture',
    payload: { ...payload, ...opts, mode },
  })) as { kind?: string; runId?: string };
  if (ack?.kind === 'capture-ack' && ack.runId && ack.runId !== 'blocked') {
    return ack.runId;
  }
  return null;
}

log.log('content script attached');
