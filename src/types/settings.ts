// User-configurable settings (§4.5). Stored in chrome.storage.local; never
// synced (N-3). API keys never leave this box except via direct provider calls
// from the offscreen document.

export type LLMProvider = 'gemini' | 'openai' | 'anthropic' | 'openrouter';
export type TTSProvider = 'edge' | 'elevenlabs' | 'browser';

export interface LLMSettings {
  provider: LLMProvider;
  apiKey: string;
  model: string;
}

export interface TTSSettings {
  provider: TTSProvider;
  apiKey?: string; // not needed for browser SpeechSynthesis
  voiceId: string;
  generateTermAudio: boolean;
}

export interface CaptureTriggerSettings {
  contextMenu: boolean;
  floatingButton: boolean;
  hotkey: boolean;
  rememberLastMode: boolean;
  lastMode?: 'A' | 'B';
}

export interface AnkiSettings {
  deckName: string;
  defaultTags: string[];
  // noteTypeName is locked to "Hermes Card" in v1 (decision §10.4).
}

export interface DebugSettings {
  agentTraceVisible: boolean;
  langsmith: { enabled: boolean; apiKey?: string; project?: string };
}

export interface Settings {
  llm: LLMSettings;
  tts: TTSSettings;
  triggers: CaptureTriggerSettings;
  anki: AnkiSettings;
  debug: DebugSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  llm: {
    provider: 'gemini',
    apiKey: '',
    model: 'gemini-2.5-flash',
  },
  tts: {
    // Default to Microsoft Edge TTS — high-quality neural voices, no key
    // required, works offline-of-account. ElevenLabs / browser remain
    // available as alternatives.
    provider: 'edge',
    apiKey: '',
    voiceId: 'en-US-JennyNeural',
    generateTermAudio: false,
  },
  triggers: {
    contextMenu: true,
    floatingButton: true,
    hotkey: true,
    rememberLastMode: false,
  },
  anki: {
    deckName: 'Hermes::English',
    defaultTags: [],
  },
  debug: {
    agentTraceVisible: false,
    langsmith: { enabled: false },
  },
};

// N-11: capture is gated until at least one LLM key + one TTS option exists.
// Edge TTS and browser SpeechSynthesis are key-free; ElevenLabs needs a key.
export function hasRequiredKeys(s: Settings): boolean {
  const llmOk = s.llm.apiKey.trim().length > 0;
  const ttsKeyless = s.tts.provider === 'browser' || s.tts.provider === 'edge';
  const ttsOk = ttsKeyless || (s.tts.apiKey ?? '').trim().length > 0;
  return llmOk && ttsOk;
}
