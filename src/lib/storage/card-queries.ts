// Card list queries for the popup view (F-4.2).

import { db } from './db';
import type { Card, TermType } from '@/types/card';

export interface CardFilter {
  search?: string;
  type?: TermType;
  domain?: string;
  exported?: 'yes' | 'no';
  tag?: string;
  dateFrom?: number;
  dateTo?: number;
  sort?: 'recent' | 'alpha';
}

export async function queryCards(f: CardFilter = {}): Promise<Card[]> {
  let coll = db().cards.toCollection();

  if (f.type) coll = coll.and((c) => c.type === f.type);
  if (f.exported === 'yes') coll = coll.and((c) => Boolean(c.exportedAt));
  if (f.exported === 'no') coll = coll.and((c) => !c.exportedAt);
  if (f.domain) {
    const d = f.domain.toLowerCase();
    coll = coll.and((c) => safeHostname(c.source.url).includes(d));
  }
  if (f.tag) coll = coll.and((c) => c.tags.includes(f.tag!));
  if (f.dateFrom) coll = coll.and((c) => c.source.capturedAt >= f.dateFrom!);
  if (f.dateTo) coll = coll.and((c) => c.source.capturedAt <= f.dateTo!);
  if (f.search) {
    const q = f.search.toLowerCase();
    coll = coll.and(
      (c) =>
        c.term.toLowerCase().includes(q) ||
        c.sentence.toLowerCase().includes(q) ||
        c.termTranslation.toLowerCase().includes(q),
    );
  }

  const arr = await coll.toArray();
  if (f.sort === 'alpha') arr.sort((a, b) => a.term.localeCompare(b.term));
  else arr.sort((a, b) => b.source.capturedAt - a.source.capturedAt);
  return arr;
}

export async function listDomains(): Promise<string[]> {
  const cards = await db().cards.toArray();
  return [...new Set(cards.map((c) => safeHostname(c.source.url)))].filter(Boolean).sort();
}

export async function listTags(): Promise<string[]> {
  const cards = await db().cards.toArray();
  return [...new Set(cards.flatMap((c) => c.tags))].sort();
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
