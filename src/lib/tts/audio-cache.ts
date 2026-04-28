// Audio cache facade over the Dexie audioBlobs store. F-3.4 keys cache by
// (text, voiceId, provider). This module is the single place tools call to
// get-or-create an audio blob — keeps the TTS provider call count down.

import { getAudio, getAudioById, putAudio } from '@/lib/storage/db';
import { uuid } from '@/lib/uuid';
import { makeLogger } from '@/lib/log';
import type { AudioBlobRecord } from '@/types/card';
import type { TTSProvider } from './types';

const log = makeLogger('tts:cache');

export async function getOrSynthesize(
  text: string,
  voiceId: string,
  provider: string,
  ttsProvider: TTSProvider,
): Promise<{ blobId: string; cached: boolean }> {
  const existing = await getAudio(text, voiceId, provider);
  if (existing) {
    log.log(`HIT provider=${provider} voice=${voiceId} chars=${text.length} blobId=${existing.id} bytes=${existing.byteLength}`);
    return { blobId: existing.id, cached: true };
  }

  log.log(`MISS provider=${provider} voice=${voiceId} chars=${text.length} — synthesizing`);
  const synthStart = Date.now();
  const blob = await ttsProvider.synthesize(text, voiceId);
  log.log(`synth done in ${Date.now() - synthStart}ms bytes=${blob.size} type=${blob.type}`);
  const id = uuid();
  const rec: AudioBlobRecord = {
    id,
    text,
    voiceId,
    provider,
    blob,
    createdAt: Date.now(),
    byteLength: blob.size,
  };
  await putAudio(rec);
  log.log(`stored blobId=${id}`);
  return { blobId: id, cached: false };
}

export async function getBlobUrl(blobId: string): Promise<string | null> {
  const rec = await getAudioById(blobId);
  if (!rec) return null;
  return URL.createObjectURL(rec.blob);
}

export async function fetchAudioBytes(blobId: string): Promise<Uint8Array | null> {
  const rec = await getAudioById(blobId);
  if (!rec) return null;
  const buf = await rec.blob.arrayBuffer();
  return new Uint8Array(buf);
}
