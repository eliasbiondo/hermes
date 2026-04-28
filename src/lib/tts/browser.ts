// Browser SpeechSynthesis fallback. Captures the spoken audio via
// MediaRecorder, then transcodes to MP3 (F-3.6, N-8) so the same .apkg works
// in Anki Desktop, Mobile, Droid, and Web.

import { decodeAudioBlobToMonoPCM, pcmToMp3 } from './encode-mp3';
import type { TTSProvider, Voice } from './types';

export class BrowserTTS implements TTSProvider {
  async synthesize(text: string, voiceId: string): Promise<Blob> {
    if (!('speechSynthesis' in window)) {
      throw new Error('SpeechSynthesis is not available in this context.');
    }

    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((v) => v.voiceURI === voiceId || v.name === voiceId);
    const utter = new SpeechSynthesisUtterance(text);
    if (voice) utter.voice = voice;

    const webm = await new Promise<Blob>((resolve, reject) => {
      try {
        const ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        const recorder = new MediaRecorder(dest.stream);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = () => {
          void ctx.close();
          resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
        };
        recorder.start();
        utter.onend = () => recorder.stop();
        utter.onerror = (e) => reject(new Error(`speechSynthesis error: ${e.error}`));
        window.speechSynthesis.speak(utter);
      } catch (e) {
        reject(e);
      }
    });

    const pcm = await decodeAudioBlobToMonoPCM(webm);
    const mp3 = await pcmToMp3(pcm);
    // Copy through ArrayBuffer to satisfy the strict BlobPart typing under
    // newer TS DOM lib (Uint8Array ⇒ ArrayBufferView<ArrayBuffer>).
    const ab = new ArrayBuffer(mp3.byteLength);
    new Uint8Array(ab).set(mp3);
    return new Blob([ab], { type: 'audio/mpeg' });
  }

  async listVoices(): Promise<Voice[]> {
    const all = window.speechSynthesis?.getVoices() ?? [];
    return all
      .filter((v) => v.lang.toLowerCase().startsWith('en'))
      .map((v) => ({ id: v.voiceURI, name: v.name, language: v.lang }));
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number }> {
    return { ok: 'speechSynthesis' in window, latencyMs: 0 };
  }
}
