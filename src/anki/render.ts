// Renders a Card's HTML field values for the Anki note. Wraps the highlight
// span in <mark class="hl"> per §4.7.

import type { Card, HighlightSpan } from '@/types/card';

export function highlightHTML(text: string, span: HighlightSpan): string {
  if (!text) return '';
  const start = Math.max(0, Math.min(span.start, text.length));
  const end = Math.max(start, Math.min(span.end, text.length));
  const before = escapeHtml(text.slice(0, start));
  const mid = escapeHtml(text.slice(start, end));
  const after = escapeHtml(text.slice(end));
  if (!mid) return escapeHtml(text);
  return `${before}<mark class="hl">${mid}</mark>${after}`;
}

export function fieldsForCard(card: Card): {
  Sentence: string;
  SentenceTranslation: string;
  Term: string;
  TermTranslation: string;
  SentenceAudio: string;
  TermAudio: string;
  SourceUrl: string;
} {
  return {
    Sentence: highlightHTML(card.sentence, card.sentenceHighlight),
    SentenceTranslation: highlightHTML(
      card.sentenceTranslation,
      card.sentenceTranslationHighlight,
    ),
    Term: card.term,
    TermTranslation: card.termTranslation,
    SentenceAudio: card.sentenceAudioBlobId ? `[sound:${audioFilename(card, 'sentence')}]` : '',
    TermAudio: card.termAudioBlobId ? `[sound:${audioFilename(card, 'term')}]` : '',
    SourceUrl: card.source.url,
  };
}

export function audioFilename(card: Card, kind: 'sentence' | 'term'): string {
  // Content-addressable filename per F-6.6 — the blob ID is unique per
  // (text, voice, provider) combination thanks to the Dexie cache.
  const id = kind === 'sentence' ? card.sentenceAudioBlobId : card.termAudioBlobId;
  return `hermes_${kind}_${id}.mp3`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
