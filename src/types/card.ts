// Data model from REQUIREMENTS.md §9. Exact shape kept in sync with the
// CardEnrichment Zod schema used by the deep agent (Phase 4).

export type HighlightSpan = { start: number; end: number };

export type TermType = 'word' | 'phrasal_verb';

export type CaptureMode = 'A_generated' | 'B_verbatim';

export type AgentRunStatus = 'complete' | 'partial' | 'failed';

export interface AgentToolCall {
  name: string;
  status: 'done' | 'failed';
  at: number;
  durationMs: number;
  error?: string;
}

export interface AgentRunMeta {
  status: AgentRunStatus;
  toolCalls: AgentToolCall[];
  llm: { provider: string; model: string };
  tts: { provider: string; voiceId: string };
  runId?: string;
}

export interface CardSource {
  url: string;
  title: string;
  capturedAt: number;
}

export interface Card {
  id: string;
  term: string;
  termTranslation: string;
  type: TermType;
  termGroupId: string;
  captureMode: CaptureMode;
  rawContext: string;
  source: CardSource;

  sentence: string;
  sentenceHighlight: HighlightSpan;
  sentenceTranslation: string;
  sentenceTranslationHighlight: HighlightSpan;

  sentenceAudioBlobId: string;
  termAudioBlobId?: string;

  agentRun: AgentRunMeta;

  tags: string[];
  exportedAt?: number;
  ankiGuid: string;
  dirtySinceExport?: boolean;
}

export interface AudioBlobRecord {
  id: string;
  text: string;
  voiceId: string;
  provider: string;
  blob: Blob;
  createdAt: number;
  byteLength: number;
}
