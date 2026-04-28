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
          // sql.js (used inside @/anki/export) touches `document` during
          // wasm bootstrap, which throws in the SW context. The offscreen
          // doc has DOM globals — but it does NOT have chrome.downloads.
          // So we split: offscreen builds the .apkg + returns a data: URL,
          // then the SW does chrome.downloads + marks cards exported.
          await ensureOffscreen();
          const settings = await loadSettings();
          const built = (await chrome.runtime.sendMessage({
            kind: 'offscreen-export-anki',
            scope: msg.scope,
            filterIds: msg.filterIds,
            settings,
          })) as
            | { ok: true; filename: string; dataUrl: string; exportedCardIds: string[] }
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
          log.log(`download starting filename=${built.filename}`);
          const downloadId = await chrome.downloads.download({
            url: built.dataUrl,
            filename: built.filename,
            saveAs: true,
          });
          log.log(`download accepted id=${downloadId} — waiting`);
          await waitForDownload(downloadId);
          log.log(`download complete id=${downloadId}`);

          const { markCardsExported } = await import('@/anki/export');
          await markCardsExported(built.exportedCardIds);

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
      const card = buildCardFromEnrichment(ctx, event.enrichment);
      await saveCard(card);
      // Tell every UI surface to refresh its catalog.
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

function waitForDownload(downloadId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === 'complete') {
        chrome.downloads.onChanged.removeListener(listener);
        resolve();
      } else if (delta.state?.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(listener);
        const reason = delta.error?.current ?? 'unknown';
        reject(new Error(`Download interrupted: ${reason}`));
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  });
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
