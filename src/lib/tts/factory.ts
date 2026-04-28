import type { TTSSettings } from '@/types/settings';
import type { TTSProvider } from './types';

export async function getTTS(settings: TTSSettings): Promise<TTSProvider> {
  if (settings.provider === 'edge') {
    const { EdgeTTS } = await import('./edge');
    return new EdgeTTS();
  }
  const { ElevenLabsTTS } = await import('./elevenlabs');
  return new ElevenLabsTTS(settings.apiKey ?? '');
}
