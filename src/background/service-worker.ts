// MV3 service worker. Message broker between content script, popup, and the
// offscreen document that hosts the deep-agent runtime (N-10).

import { makeLogger } from '@/lib/log';
import { loadSettings, onSettingsChanged, saveSettings } from '@/lib/storage/settings-store';
import { hasRequiredKeys } from '@/types/settings';
import { uuid, ankiGuidFor } from '@/lib/uuid';
import { db, listCards, saveCard } from '@/lib/storage/db';
import type {
  AgentRequest,
  AgentStreamEvent,
  BackgroundToContent,
  BackgroundToUI,
  ContentToBackground,
  OffscreenToBackground,
  PendingRunSummary,
  UIToBackground,
} from '@/types/messages';
import type { AgentRunMeta, Card, CaptureMode, HighlightSpan } from '@/types/card';

const log = makeLogger('sw');

const CTX_MENU_ID = 'hermes-add';
const OFFSCREEN_URL = 'src/offscreen/index.html';

// runId → in-flight context the SW needs to write the saved Card once the
// agent completes.
interface PendingRun {
  runId: string;
  mode: CaptureMode;
  term: string;
  termGroupId: string;
  payloadCapturedAt: number;
  pageUrl: string;
  pageTitle: string;
  rawContext: string;
  sentence?: string;
  termSpan?: HighlightSpan;
  toolCalls: AgentRunMeta['toolCalls'];
  llm: AgentRunMeta['llm'];
  tts: AgentRunMeta['tts'];
  senderTabId?: number;
  startedAt: number;
  // When set, the run is a regenerate against an existing card — the result
  // updates that card in place rather than inserting a fresh one. F-2.8.
  regenerateCardId?: string;
}
const pending = new Map<string, PendingRun>();

function pendingSummary(): PendingRunSummary[] {
  return [...pending.values()].map((p) => ({
    runId: p.runId,
    term: p.term,
    mode: p.mode,
    startedAt: p.startedAt,
    toolCalls: p.toolCalls.map((t) => ({
      name: t.name,
      status: t.status,
      durationMs: t.durationMs,
    })),
  }));
}

function broadcastPending(): void {
  const msg: BackgroundToUI = { kind: 'pending-runs', runs: pendingSummary() };
  chrome.runtime.sendMessage(msg).catch(() => undefined);
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({
    id: CTX_MENU_ID,
    title: "Add '%s' to Hermes",
    contexts: ['selection'],
  });
  if (details.reason === 'install') {
    void chrome.tabs.create({
      url: chrome.runtime.getURL('src/onboarding/index.html'),
    });
  }
  log.log('installed', { reason: details.reason });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CTX_MENU_ID || !tab?.id) return;
  void chrome.tabs.sendMessage(tab.id, {
    kind: 'capture-trigger',
    via: 'context-menu',
    selectionText: info.selectionText ?? '',
  });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'capture-selection' || !tab?.id) return;
  void chrome.tabs.sendMessage(tab.id, { kind: 'capture-trigger', via: 'hotkey' });
});

// Toolbar icon: toggle the in-page floating panel (Cuponomia-style).
// On restricted tabs (chrome://, web store, PDFs, etc.) where content scripts
// can't run, fall back to opening the options page. On normal tabs, retry
// after programmatically injecting the content script — handles the case
// where the extension was reloaded but the tab wasn't refreshed.
chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  const tabId = tab.id;
  const restricted =
    !tab.url ||
    /^(chrome|edge|about|chrome-extension|chrome-search|view-source):/i.test(tab.url) ||
    /chrome\.google\.com\/webstore/i.test(tab.url);
  if (restricted) {
    void chrome.runtime.openOptionsPage();
    return;
  }
  void (async () => {
    try {
      await chrome.tabs.sendMessage(tabId, { kind: 'toggle-panel' });
      return;
    } catch {
      // No content script yet — inject it and retry below.
    }
    try {
      const manifest = chrome.runtime.getManifest();
      const files = manifest.content_scripts?.[0]?.js ?? [];
      if (files.length === 0) return;
      await chrome.scripting.executeScript({ target: { tabId }, files });
      // Listener registration runs after the script's dynamic chunk imports
      // resolve. Retry sendMessage with short backoff until it lands.
      for (let i = 0; i < 10; i += 1) {
        try {
          await chrome.tabs.sendMessage(tabId, { kind: 'toggle-panel' });
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      log.warn('toggle-panel: content script never responded after injection');
    } catch (e) {
      log.warn('toggle-panel failed', e instanceof Error ? e.message : String(e));
    }
  })();
});

onSettingsChanged((settings) => {
  void chrome.tabs.query({}).then((tabs) => {
    for (const t of tabs) {
      if (t.id !== undefined) {
        chrome.tabs
          .sendMessage(t.id, { kind: 'settings-changed', settings })
          .catch(() => undefined);
      }
    }
  });
});

chrome.runtime.onMessage.addListener(
  (
    msg:
      | ContentToBackground
      | UIToBackground
      | OffscreenToBackground
      | { kind: 'open-options'; reason: string }
      | { kind: 'remember-last-mode'; mode: 'A' | 'B' }
      | (ContentToBackground & {
          payload: { mode?: CaptureMode; sentence?: string; termSpan?: HighlightSpan };
        }),
    sender,
    sendResponse,
  ) => {
    log.log('message in', msg.kind);

    if (msg.kind === 'open-options') {
      void chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      return false;
    }

    if (msg.kind === 'remember-last-mode') {
      void saveSettings({ triggers: { lastMode: msg.mode } as never });
      sendResponse({ ok: true });
      return false;
    }

    if (msg.kind === 'capture') {
      void (async () => {
        const runId = await handleCapture(msg.payload as never, sender.tab?.id);
        const ack: BackgroundToContent = {
          kind: 'capture-ack',
          runId: runId ?? 'blocked',
        };
        sendResponse(ack);
      })();
      return true;
    }

    if ((msg as { kind?: string }).kind === 'get-settings') {
      void loadSettings().then((s) => sendResponse({ kind: 'settings', settings: s }));
      return true;
    }

    if (msg.kind === 'list-cards') {
      void listCards().then((cards) => {
        const reply: BackgroundToUI = { kind: 'cards', cards };
        sendResponse(reply);
      });
      return true;
    }

    if (msg.kind === 'list-pending-runs') {
      const reply: BackgroundToUI = { kind: 'pending-runs', runs: pendingSummary() };
      sendResponse(reply);
      return false;
    }

    if (msg.kind === 'export-anki') {
      void (async () => {
        log.log('export-anki start', { scope: msg.scope, count: msg.filterIds?.length });
        try {
          // Offscreen doc both builds the .apkg AND triggers the download
          // via an <a download="…"> click. Chrome bug 579563 makes
          // chrome.downloads.download(filename) unreliable on blob URLs —
          // <a download> reliably honors the filename across versions and
          // locales. The SW only relays the response and archives cards.
          await ensureOffscreen();
          const settings = await loadSettings();
          const built = (await chrome.runtime.sendMessage({
            kind: 'offscreen-export-anki',
            scope: msg.scope,
            filterIds: msg.filterIds,
            settings,
          })) as
            | { ok: true; filename: string; exportedCardIds: string[] }
            | { ok: false; error: string }
            | undefined;
          if (!built) {
            sendResponse({ ok: false, error: 'No response from offscreen.' });
            return;
          }
          if (!built.ok) {
            sendResponse(built);
            return;
          }
          log.log(`download triggered by offscreen filename=${built.filename}`);

          // Archive cards in Dexie inline (not via @/anki/export) so the SW
          // never loads any chunk that transitively touches `document`.
          const now = Date.now();
          await db()
            .cards.where('id')
            .anyOf(built.exportedCardIds)
            .modify({ exportedAt: now, dirtySinceExport: false });
          chrome.runtime.sendMessage({ kind: 'cards-changed' }).catch(() => undefined);

          sendResponse({ ok: true, filename: built.filename, count: built.exportedCardIds.length });
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          log.error(`export-anki threw: ${error}`);
          sendResponse({ ok: false, error });
        }
      })();
      return true;
    }

    if ((msg as { kind?: string }).kind === 'regenerate') {
      const m = msg as unknown as { kind: 'regenerate'; cardId: string; scope: 'all' | 'translation' };
      void (async () => {
        const card = await db().cards.get(m.cardId);
        if (!card) return sendResponse({ ok: false, error: 'Card not found' });
        const runId = await handleCapture(
          {
            selectionText: card.term,
            rawContext: card.rawContext,
            pageUrl: card.source.url,
            pageTitle: card.source.title,
            capturedAt: card.source.capturedAt,
            mode: card.captureMode,
            sentence: card.sentence,
            termSpan: card.sentenceHighlight,
          } as never,
          undefined,
          card.id,
        );
        sendResponse({ ok: Boolean(runId), runId, scope: m.scope });
      })();
      return true;
    }

    if (msg.kind === 'agent-event') {
      void handleAgentEvent(msg.event);
      sendResponse({ ok: true });
      return false;
    }

    sendResponse({ ok: true });
    return false;
  },
);

async function handleCapture(
  payload: import('@/types/messages').CapturePayload & {
    mode?: CaptureMode;
    sentence?: string;
    termSpan?: HighlightSpan;
  },
  senderTabId?: number,
  regenerateCardId?: string,
): Promise<string | null> {
  const settings = await loadSettings();
  if (!hasRequiredKeys(settings)) {
    void chrome.runtime.openOptionsPage();
    return null;
  }

  const mode: CaptureMode = payload.mode ?? 'A_generated';
  const runId = uuid();
  const term =
    mode === 'B_verbatim' && payload.sentence && payload.termSpan
      ? payload.sentence.slice(payload.termSpan.start, payload.termSpan.end)
      : payload.selectionText;

  // Duplicate detection (F-4.6): variants share termGroupId. Default action
  // here is "save as variant" — UX for replace/cancel is Phase 8 polish.
  const existing = await db()
    .cards.where('term')
    .equalsIgnoreCase(term.trim())
    .first();
  const termGroupId = existing?.termGroupId ?? runId;

  pending.set(runId, {
    runId,
    mode,
    term,
    termGroupId,
    payloadCapturedAt: payload.capturedAt,
    pageUrl: payload.pageUrl,
    pageTitle: payload.pageTitle,
    rawContext: payload.rawContext,
    ...(payload.sentence !== undefined ? { sentence: payload.sentence } : {}),
    ...(payload.termSpan !== undefined ? { termSpan: payload.termSpan } : {}),
    toolCalls: [],
    llm: { provider: settings.llm.provider, model: settings.llm.model },
    tts: { provider: settings.tts.provider, voiceId: settings.tts.voiceId },
    ...(senderTabId !== undefined ? { senderTabId } : {}),
    ...(regenerateCardId !== undefined ? { regenerateCardId } : {}),
    startedAt: Date.now(),
  });
  broadcastPending();

  await ensureOffscreen();

  const req: AgentRequest = {
    runId,
    mode: mode === 'A_generated' ? 'A' : 'B',
    term,
    settings,
    ...(payload.rawContext ? { rawContext: payload.rawContext } : {}),
    ...(payload.sentence ? { sentence: payload.sentence } : {}),
    ...(payload.termSpan ? { termSpan: payload.termSpan } : {}),
  };

  void chrome.runtime.sendMessage({ kind: 'run-agent', req });
  return runId;
}

async function handleAgentEvent(event: AgentStreamEvent): Promise<void> {
  // Forward to any open UI surfaces (popup/options).
  const fanout: BackgroundToUI = { kind: 'agent-event', event };
  chrome.runtime.sendMessage(fanout).catch(() => undefined);

  const ctx = pending.get(event.runId);
  // Forward to the originating tab so the in-page popover can stream
  // per-step status (F-2.3, U-4).
  if (ctx?.senderTabId !== undefined) {
    chrome.tabs.sendMessage(ctx.senderTabId, fanout).catch(() => undefined);
  }
  if (!ctx) return;

  if (event.kind === 'tool_end' || event.kind === 'tool_error') {
    ctx.toolCalls.push({
      name: event.tool,
      status: event.kind === 'tool_error' ? 'failed' : 'done',
      at: event.at,
      durationMs: event.durationMs ?? 0,
      ...(event.error ? { error: event.error } : {}),
    });
    broadcastPending();
  }

  if (event.kind === 'result') {
    pending.delete(event.runId);
    broadcastPending();
    // Only persist a card when the run completed successfully with a full
    // enrichment. Partial / failed runs surface in the popover via the
    // streamed `result` event but never produce a stored card.
    if (event.status === 'complete' && event.enrichment) {
      // Regenerate path: update the existing card in place so we don't
      // accumulate duplicates, and so its ankiGuid (and therefore Anki's
      // notion of the card) survives. F-2.8 / F-6.6.
      if (ctx.regenerateCardId) {
        const existing = await db().cards.get(ctx.regenerateCardId);
        if (existing) {
          const updated: Card = {
            ...existing,
            type: event.enrichment.type,
            termTranslation: event.enrichment.termTranslation,
            sentence: event.enrichment.sentence,
            sentenceHighlight: event.enrichment.sentenceHighlight,
            sentenceTranslation: event.enrichment.sentenceTranslation,
            sentenceTranslationHighlight: event.enrichment.sentenceTranslationHighlight,
            sentenceAudioBlobId: event.enrichment.sentenceAudioBlobId,
            ...(event.enrichment.termAudioBlobId
              ? { termAudioBlobId: event.enrichment.termAudioBlobId }
              : {}),
            agentRun: {
              status: 'complete',
              toolCalls: ctx.toolCalls,
              llm: ctx.llm,
              tts: ctx.tts,
            },
            // If the card was already in the archive, mark it as edited so
            // the next export bundles the refresh (F-6.6).
            ...(existing.exportedAt ? { dirtySinceExport: true } : {}),
          };
          await saveCard(updated);
        } else {
          // Lost the original (deleted mid-flight) — fall back to inserting.
          const card = buildCardFromEnrichment(ctx, event.enrichment);
          await saveCard(card);
        }
      } else {
        const card = buildCardFromEnrichment(ctx, event.enrichment);
        await saveCard(card);
      }
      chrome.runtime.sendMessage({ kind: 'cards-changed' }).catch(() => undefined);
    } else {
      log.warn('agent run did not complete; nothing saved', {
        runId: event.runId,
        status: event.status,
        error: event.error,
      });
    }
  }
}

function buildCardFromEnrichment(
  ctx: PendingRun,
  e: import('@/agent/schema').CardEnrichment,
): Card {
  const id = uuid();
  return {
    id,
    term: ctx.term,
    termTranslation: e.termTranslation,
    type: e.type,
    termGroupId: ctx.termGroupId,
    captureMode: ctx.mode,
    rawContext: ctx.rawContext,
    source: { url: ctx.pageUrl, title: ctx.pageTitle, capturedAt: ctx.payloadCapturedAt },
    sentence: e.sentence,
    sentenceHighlight: e.sentenceHighlight,
    sentenceTranslation: e.sentenceTranslation,
    sentenceTranslationHighlight: e.sentenceTranslationHighlight,
    sentenceAudioBlobId: e.sentenceAudioBlobId,
    ...(e.termAudioBlobId ? { termAudioBlobId: e.termAudioBlobId } : {}),
    agentRun: {
      status: 'complete',
      toolCalls: ctx.toolCalls,
      llm: ctx.llm,
      tts: ctx.tts,
    },
    tags: [],
    ankiGuid: ankiGuidFor(id),
  };
}

async function ensureOffscreen(): Promise<void> {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.BLOBS],
    justification:
      'Hosts the deep-agent runtime so long-running enrichment loops survive the MV3 service-worker idle timeout.',
  });
  log.log('offscreen document opened');
}

export { ensureOffscreen };
