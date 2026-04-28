import type { TTSProvider, Voice } from './types';

export class ElevenLabsTTS implements TTSProvider {
  constructor(private apiKey: string) {}

  async synthesize(text: string, voiceId: string): Promise<Blob> {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_v3',
        output_format: 'mp3_44100_128',
      }),
    });
    if (!r.ok) throw new Error(`ElevenLabs synthesize: HTTP ${r.status} ${await r.text().catch(() => '')}`);
    return await r.blob();
  }

  async listVoices(): Promise<Voice[]> {
    const r = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': this.apiKey },
    });
    if (!r.ok) throw new Error(`ElevenLabs voices: HTTP ${r.status}`);
    const data = (await r.json()) as { voices: Array<{ voice_id: string; name: string; preview_url?: string }> };
    return data.voices.map((v) => ({
      id: v.voice_id,
      name: v.name,
      preview: v.preview_url,
      language: 'en',
    }));
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = performance.now();
    const r = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': this.apiKey },
    });
    return { ok: r.ok, latencyMs: Math.round(performance.now() - start) };
  }
}
