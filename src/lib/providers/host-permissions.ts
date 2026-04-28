// Provider host permissions are now declared at install time (see
// manifest.config.ts) so we don't need a runtime permission flow. The helpers
// stay as no-ops to keep the call sites simple — if we ever go back to
// optional_host_permissions, the request logic returns here.

import type { LLMProvider, TTSProvider } from '@/types/settings';

export const LLM_HOSTS: Record<LLMProvider, string> = {
  gemini: 'https://generativelanguage.googleapis.com/*',
  openai: 'https://api.openai.com/*',
  anthropic: 'https://api.anthropic.com/*',
  openrouter: 'https://openrouter.ai/*',
};

export const TTS_HOSTS: Partial<Record<TTSProvider, string>> = {
  edge: 'https://speech.platform.bing.com/*',
  elevenlabs: 'https://api.elevenlabs.io/*',
};

export async function ensureLLMPermission(_provider: LLMProvider): Promise<boolean> {
  return true;
}

export async function ensureTTSPermission(_provider: TTSProvider): Promise<boolean> {
  return true;
}
