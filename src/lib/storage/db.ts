// Dexie schema. Single store for cards, one for audio blobs (F-3.4).
// Indexes match the filters required by the cards list view (F-4.2):
// term, type, exportedAt, source.url (domain), capturedAt, tags (multi).

import Dexie, { type EntityTable } from 'dexie';
import type { AudioBlobRecord, Card } from '@/types/card';

class HermesDB extends Dexie {
  cards!: EntityTable<Card, 'id'>;
  audioBlobs!: EntityTable<AudioBlobRecord, 'id'>;

  constructor() {
    super('hermes');
    this.version(1).stores({
      cards:
        '&id, term, type, termGroupId, exportedAt, captureMode, ' +
        'source.url, source.capturedAt, *tags',
      audioBlobs: '&id, [text+voiceId+provider], createdAt',
    });
  }
}

let _db: HermesDB | null = null;
export function db(): HermesDB {
  if (!_db) _db = new HermesDB();
  return _db;
}

// ── Cards ──────────────────────────────────────────────────────────────
export async function saveCard(card: Card): Promise<void> {
  await db().cards.put(card);
}

export async function getCard(id: string): Promise<Card | undefined> {
  return db().cards.get(id);
}

export async function listCards(): Promise<Card[]> {
  return db().cards.orderBy('source.capturedAt').reverse().toArray();
}

export async function deleteCards(ids: string[]): Promise<void> {
  await db().cards.bulkDelete(ids);
}

export async function findVariants(termGroupId: string): Promise<Card[]> {
  return db().cards.where('termGroupId').equals(termGroupId).toArray();
}

// ── Audio cache (F-3.4) ────────────────────────────────────────────────
export async function getAudio(
  text: string,
  voiceId: string,
  provider: string,
): Promise<AudioBlobRecord | undefined> {
  return db()
    .audioBlobs.where('[text+voiceId+provider]')
    .equals([text, voiceId, provider])
    .first();
}

export async function putAudio(rec: AudioBlobRecord): Promise<void> {
  await db().audioBlobs.put(rec);
}

export async function getAudioById(id: string): Promise<AudioBlobRecord | undefined> {
  return db().audioBlobs.get(id);
}
