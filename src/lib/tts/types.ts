// TTS provider abstraction (§8). Concrete impls live alongside in this dir
// and are dynamically imported so unused providers stay out of the bundle.

export interface Voice {
  id: string;
  name: string;
  language?: string;
  preview?: string;
}

export interface TTSProvider {
  synthesize(text: string, voiceId: string): Promise<Blob>;
  listVoices(): Promise<Voice[]>;
  testConnection(): Promise<{ ok: boolean; latencyMs: number }>;
}
