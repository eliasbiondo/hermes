// User-configurable settings (§4.5). Stored in chrome.storage.local; never
// synced (N-3). API keys never leave this box except via direct provider calls
// from the offscreen document.

export type LLMProvider = 'gemini' | 'openai' | 'anthropic' | 'openrouter';
export type TTSProvider = 'edge' | 'elevenlabs';

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

// User-facing language names (shown in the UI and inserted verbatim into the
// LLM system prompt). Using full names keeps the prompts model-friendly and
// the cards legible.
export const LANGUAGE_OPTIONS = [
  'English',
  'Portuguese (Brazil)',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Dutch',
  'Japanese',
  'Korean',
  'Chinese (Simplified)',
  'Chinese (Traditional)',
  'Russian',
  'Polish',
  'Turkish',
  'Arabic',
] as const;

// Edge "Read Aloud" only ships English neural voices in the curated list
// Hermes exposes — gate it on the user's learning language so non-English
// learners don't end up with an English-accented voice.
export function isEdgeAvailableFor(language: LanguageName): boolean {
  return language === 'English';
}

export type LanguageName = (typeof LANGUAGE_OPTIONS)[number];

export interface LanguageSettings {
  // The language the user is studying (source of selections + sentences).
  learning: LanguageName;
  // The user's fluent language (target of translations).
  fluent: LanguageName;
}

export interface Settings {
  llm: LLMSettings;
  tts: TTSSettings;
  triggers: CaptureTriggerSettings;
  anki: AnkiSettings;
  debug: DebugSettings;
  language: LanguageSettings;
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
  language: {
    learning: 'English',
    fluent: 'Portuguese (Brazil)',
  },
};

// N-11: capture is gated until at least one LLM key + one TTS option exists.
// Edge TTS is key-free; ElevenLabs needs a key.
export function hasRequiredKeys(s: Settings): boolean {
  const llmOk = s.llm.apiKey.trim().length > 0;
  const ttsKeyless = s.tts.provider === 'edge';
  const ttsOk = ttsKeyless || (s.tts.apiKey ?? '').trim().length > 0;
  return llmOk && ttsOk;
}
