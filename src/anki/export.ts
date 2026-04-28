// Export entry point. Called from the SW message handler. Heavy modules
// (sql.js, JSZip) are dynamically imported so they only land in the bundle
// when the user actually clicks Export (N-9).

import { db } from '@/lib/storage/db';
import { DEFAULT_SETTINGS, type Settings } from '@/types/settings';
import { makeLogger } from '@/lib/log';
import type { Card } from '@/types/card';

const log = makeLogger('export');

export type ExportScope = 'all' | 'pending' | 'filter';

export interface BuildResult {
  ok: true;
  filename: string;
  dataUrl: string;
  exportedCardIds: string[];
}
export interface BuildError {
  ok: false;
  error: string;
}

// Builds the .apkg in the offscreen doc (sql.js needs `document`; the SW
// doesn't have it). Returns a self-contained data: URL so the SW can hand
// it to chrome.downloads without needing access to the original blob.
//
// Settings are passed in from the SW because chrome.storage.local isn't
// reliably exposed to dynamically-imported chunks in the offscreen doc
// under the @crxjs loader (same constraint as the agent runner).
export async function buildAnkiPackage(
  scope: ExportScope,
  filterIds?: string[],
  settings: Settings = DEFAULT_SETTINGS,
): Promise<BuildResult | BuildError> {
  try {
    const cards = await collectCards(scope, filterIds);
    log.log(`scope=${scope} matched ${cards.length} cards`);
    if (cards.length === 0) return { ok: false, error: 'No cards match the selected scope.' };

    const { buildApkg } = await import('./apkg');
    const buildStart = Date.now();
    const { blob, filename, exportedCardIds } = await buildApkg(settings.anki.deckName, cards);
    log.log(`apkg built filename=${filename} size=${blob.size} cards=${exportedCardIds.length} in ${Date.now() - buildStart}ms`);

    const dataUrl = await blobToDataUrl(blob);
    log.log(`packaged ${(dataUrl.length / 1024).toFixed(0)}kB data: URL`);

    return { ok: true, filename, dataUrl, exportedCardIds };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`build failed: ${msg}`);
    return { ok: false, error: msg };
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error('FileReader error'));
    r.onload = () => resolve(r.result as string);
    r.readAsDataURL(blob);
  });
}

// Marks cards as exported. Called from the SW after chrome.downloads finishes.
export async function markCardsExported(ids: string[]): Promise<void> {
  const now = Date.now();
  await db().cards.where('id').anyOf(ids).modify({ exportedAt: now, dirtySinceExport: false });
}

async function collectCards(scope: ExportScope, filterIds?: string[]): Promise<Card[]> {
  if (scope === 'filter' && filterIds?.length) {
    return db().cards.where('id').anyOf(filterIds).toArray();
  }
  if (scope === 'pending') {
    return db().cards.filter((c) => !c.exportedAt).toArray();
  }
  return db().cards.toArray();
}
