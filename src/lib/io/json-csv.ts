// CSV/JSON export and JSON import (§4.8). Uses no external libraries.

import { db, listCards, saveCard } from '@/lib/storage/db';
import type { Card } from '@/types/card';

export async function exportJSON(): Promise<Blob> {
  const cards = await listCards();
  return new Blob([JSON.stringify({ version: 1, cards }, null, 2)], {
    type: 'application/json',
  });
}

export async function exportCSV(): Promise<Blob> {
  const cards = await listCards();
  const rows = [
    ['term', 'sentence', 'sentence_translation', 'term_translation', 'audio_filename', 'tags'],
    ...cards.map((c) => [
      c.term,
      c.sentence,
      c.sentenceTranslation,
      c.termTranslation,
      c.sentenceAudioBlobId ? `hermes_sentence_${c.sentenceAudioBlobId}.mp3` : '',
      c.tags.join(' '),
    ]),
  ];
  const csv = rows.map((r) => r.map(escapeCsv).join(',')).join('\n');
  return new Blob([csv], { type: 'text/csv' });
}

export async function importJSON(text: string): Promise<{ added: number; skipped: number }> {
  const data = JSON.parse(text) as { version?: number; cards?: Card[] };
  if (!Array.isArray(data.cards)) throw new Error('Invalid backup file.');
  let added = 0;
  let skipped = 0;
  for (const card of data.cards) {
    const existing = await db().cards.get(card.id);
    if (existing) {
      skipped++;
      continue;
    }
    await saveCard(card);
    added++;
  }
  return { added, skipped };
}

function escapeCsv(s: string): string {
  if (s == null) return '';
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
