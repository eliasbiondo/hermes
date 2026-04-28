// Lightweight provider round-trip check (F-5.4). Used by the options page's
// "Test connection" buttons. Real LLM client wiring lives in Phase 4 in the
// offscreen document; this module makes a single direct fetch with the user's
// key so we don't have to load LangChain just to validate credentials.

import type { LLMSettings, TTSSettings } from '@/types/settings';

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const start = performance.now();
  const value = await fn();
  return { value, latencyMs: Math.round(performance.now() - start) };
}

export async function testLLM(s: LLMSettings): Promise<TestResult> {
  if (!s.apiKey.trim()) return { ok: false, latencyMs: 0, message: 'API key is empty.' };
  try {
    const { value, latencyMs } = await timed(() => probeLLM(s));
    return { ok: value.ok, latencyMs, message: value.message };
  } catch (e) {
    return { ok: false, latencyMs: 0, message: errorMessage(e) };
  }
}

async function probeLLM(s: LLMSettings): Promise<{ ok: boolean; message: string }> {
  switch (s.provider) {
    case 'gemini': {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(s.apiKey)}`,
      );
      return { ok: r.ok, message: r.ok ? 'Gemini reachable.' : `Gemini: HTTP ${r.status}` };
    }
    case 'openai': {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${s.apiKey}` },
      });
      return { ok: r.ok, message: r.ok ? 'OpenAI reachable.' : `OpenAI: HTTP ${r.status}` };
    }
    case 'anthropic': {
      // Anthropic has no models endpoint; do a tiny messages call instead.
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': s.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: s.model || 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      return { ok: r.ok, message: r.ok ? 'Anthropic reachable.' : `Anthropic: HTTP ${r.status}` };
    }
    case 'openrouter': {
      const r = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${s.apiKey}` },
      });
      return { ok: r.ok, message: r.ok ? 'OpenRouter reachable.' : `OpenRouter: HTTP ${r.status}` };
    }
  }
}

export async function testTTS(s: TTSSettings): Promise<TestResult> {
  if (s.provider === 'browser') {
    const ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
    return {
      ok,
      latencyMs: 0,
      message: ok ? 'Browser SpeechSynthesis available.' : 'SpeechSynthesis not available.',
    };
  }
  if (s.provider === 'edge') {
    try {
      const { value, latencyMs } = await timed(async () => {
        const r = await fetch(
          'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4',
        );
        return {
          ok: r.ok,
          message: r.ok
            ? 'Microsoft Edge TTS reachable.'
            : `Edge TTS: HTTP ${r.status}`,
        };
      });
      return { ok: value.ok, latencyMs, message: value.message };
    } catch (e) {
      return { ok: false, latencyMs: 0, message: errorMessage(e) };
    }
  }
  if (!s.apiKey?.trim()) return { ok: false, latencyMs: 0, message: 'API key is empty.' };
  try {
    const { value, latencyMs } = await timed(async () => {
      const r = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': s.apiKey ?? '' },
      });
      return { ok: r.ok, message: r.ok ? 'ElevenLabs reachable.' : `ElevenLabs: HTTP ${r.status}` };
    });
    return { ok: value.ok, latencyMs, message: value.message };
  } catch (e) {
    return { ok: false, latencyMs: 0, message: errorMessage(e) };
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
