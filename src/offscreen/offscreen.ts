// Offscreen document — hosts the deep-agent runtime so the long-running
// enrichment loop survives the MV3 SW idle timeout (N-10). Also runs the
// .apkg builder because sql.js touches `document` during wasm bootstrap and
// that throws in the SW context.

import { makeLogger } from '@/lib/log';
import type {
  BackgroundToOffscreen,
  OffscreenToBackground,
} from '@/types/messages';

const log = makeLogger('offscreen');

chrome.runtime.onMessage.addListener(
  (msg: BackgroundToOffscreen, _sender, sendResponse) => {
    if (msg.kind === 'run-agent') {
      log.log('run-agent received', { runId: msg.req.runId, mode: msg.req.mode });

      // Lazy-load the runner so the heavy modules (deepagents, langchain,
      // provider SDKs) only enter the bundle on first capture.
      void (async () => {
        try {
          const { runEnrichment } = await import('@/agent/runner');
          const result = await runEnrichment(msg.req, (event) => {
            const out: OffscreenToBackground = { kind: 'agent-event', event };
            chrome.runtime.sendMessage(out).catch(() => undefined);
          });
          const out: OffscreenToBackground = {
            kind: 'agent-event',
            event: {
              runId: msg.req.runId,
              kind: 'result',
              status: result.status,
              ...(result.enrichment ? { enrichment: result.enrichment } : {}),
              ...(result.error ? { error: result.error } : {}),
            },
          };
          chrome.runtime.sendMessage(out).catch(() => undefined);
          sendResponse({ ok: true });
        } catch (e) {
          const out: OffscreenToBackground = {
            kind: 'agent-event',
            event: {
              runId: msg.req.runId,
              kind: 'result',
              status: 'failed',
              error: e instanceof Error ? e.message : String(e),
            },
          };
          chrome.runtime.sendMessage(out).catch(() => undefined);
          sendResponse({ ok: false });
        }
      })();
      return true;
    }

    if (msg.kind === 'offscreen-export-anki') {
      log.log('export-anki received', { scope: msg.scope, count: msg.filterIds?.length });
      void (async () => {
        try {
          const { buildAnkiPackage } = await import('@/anki/export');
          const result = await buildAnkiPackage(msg.scope, msg.filterIds, msg.settings);
          log.log('build done', { ok: result.ok });
          sendResponse(result);
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          log.error(`export-anki threw: ${error}`);
          sendResponse({ ok: false, error });
        }
      })();
      return true;
    }

    return false;
  },
);

log.log('offscreen ready');
