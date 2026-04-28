// Message protocol between content script ⇄ service worker ⇄ offscreen doc.
// Tagged-union with `kind` so each side can switch on it exhaustively.

import type { CaptureMode, Card, HighlightSpan, TermType } from './card';
import type { Settings } from './settings';

export interface CapturePayload {
  selectionText: string;
  rawContext: string; // Mode A: surrounding sentence (≤300 chars). Mode B: empty.
  pageUrl: string;
  pageTitle: string;
  capturedAt: number;
}

export interface AgentRequest {
  runId: string;
  mode: 'A' | 'B';
  // Mode A: term is the captured selection.
  // Mode B: term is what the user highlighted inside `sentence`.
  term: string;
  termType?: TermType; // user override; agent re-classifies if absent
  // Mode A only:
  rawContext?: string;
  // Mode B only:
  sentence?: string;
  termSpan?: HighlightSpan;
  // Settings snapshot from SW so the offscreen runtime doesn't have to touch
  // chrome.storage (which isn't reliably exposed to dynamically-imported
  // chunks under the @crxjs loader).
  settings: Settings;
}

export interface AgentToolEvent {
  runId: string;
  kind: 'tool_start' | 'tool_end' | 'tool_error';
  tool: string;
  at: number;
  durationMs?: number;
  error?: string;
}

export interface AgentResultEvent {
  runId: string;
  kind: 'result';
  status: 'complete' | 'partial' | 'failed';
  card?: Card;
  enrichment?: import('@/agent/schema').CardEnrichment;
  error?: string;
}

export type AgentStreamEvent = AgentToolEvent | AgentResultEvent;

// ─── content → SW ─────────────────────────────────────────────────────────
export type ContentToBackground =
  | { kind: 'capture'; payload: CapturePayload }
  | { kind: 'ping' };

// ─── SW → content ─────────────────────────────────────────────────────────
export type BackgroundToContent =
  | { kind: 'capture-ack'; runId: string }
  | { kind: 'capture-blocked'; reason: 'missing-keys' };

// ─── popup/options → SW ───────────────────────────────────────────────────
export type UIToBackground =
  | { kind: 'start-enrichment'; req: AgentRequest; mode: CaptureMode }
  | { kind: 'list-cards' }
  | { kind: 'list-pending-runs' }
  | { kind: 'export-anki'; scope: 'all' | 'pending' | 'filter'; filterIds?: string[] };

export interface PendingRunSummary {
  runId: string;
  term: string;
  mode: CaptureMode;
  startedAt: number;
  toolCalls: { name: string; status: 'done' | 'failed'; durationMs: number }[];
}

// ─── SW → popup/options ───────────────────────────────────────────────────
export type BackgroundToUI =
  | { kind: 'agent-event'; event: AgentStreamEvent }
  | { kind: 'cards'; cards: Card[] }
  | { kind: 'pending-runs'; runs: PendingRunSummary[] };

// ─── SW ⇄ offscreen ───────────────────────────────────────────────────────
// Note: kinds for SW→offscreen messages must NOT collide with UI→SW kinds,
// because chrome.runtime.sendMessage broadcasts to every listener in the
// extension (including the sender's own onMessage). A distinct kind lets
// each context route correctly.
export type BackgroundToOffscreen =
  | { kind: 'run-agent'; req: AgentRequest }
  | {
      kind: 'offscreen-export-anki';
      scope: 'all' | 'pending' | 'filter';
      filterIds?: string[];
      settings: Settings;
    };
export type OffscreenToBackground =
  | { kind: 'agent-event'; event: AgentStreamEvent };
