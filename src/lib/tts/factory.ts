import type { TTSSettings } from '@/types/settings';
import type { TTSProvider } from './types';

export async function getTTS(settings: TTSSettings): Promise<TTSProvider> {
  if (settings.provider === 'edge') {
    const { EdgeTTS } = await import('./edge');
    return new EdgeTTS();
  }
  if (settings.provider === 'elevenlabs') {
    const { ElevenLabsTTS } = await import('./elevenlabs');
    return new ElevenLabsTTS(settings.apiKey ?? '');
  }
  const { BrowserTTS } = await import('./browser');
  return new BrowserTTS();
}
