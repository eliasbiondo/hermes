// Surrounding-sentence extraction (F-1.6) and tokenization for Mode B
// sub-selection (F-1.5). Uses Intl.Segmenter when available; falls back to a
// simple regex tokenizer.

const MAX_RAW_CONTEXT = 300;

export function extractSurroundingSentence(
  fullText: string,
  selection: string,
  selectionOffset?: number,
): string {
  if (!fullText || !selection) return selection;
  const idx =
    selectionOffset !== undefined && selectionOffset >= 0
      ? selectionOffset
      : fullText.indexOf(selection);
  if (idx < 0) return selection;

  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
    for (const s of seg.segment(fullText)) {
      const start = s.index;
      const end = s.index + s.segment.length;
      if (idx >= start && idx < end) {
        return s.segment.trim().slice(0, MAX_RAW_CONTEXT);
      }
    }
  }

  const start = Math.max(
    0,
    Math.max(
      fullText.lastIndexOf('.', idx),
      fullText.lastIndexOf('!', idx),
      fullText.lastIndexOf('?', idx),
    ) + 1,
  );
  const after = fullText.slice(idx + selection.length);
  const endRel = after.search(/[.!?](\s|$)/);
  const end = endRel < 0 ? fullText.length : idx + selection.length + endRel + 1;
  return fullText.slice(start, end).trim().slice(0, MAX_RAW_CONTEXT);
}

export interface Token {
  text: string;
  start: number;
  end: number;
  isWord: boolean;
}

export function tokenize(sentence: string): Token[] {
  const out: Token[] = [];
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter('en', { granularity: 'word' });
    for (const s of seg.segment(sentence)) {
      out.push({
        text: s.segment,
        start: s.index,
        end: s.index + s.segment.length,
        isWord: Boolean((s as Intl.SegmentData).isWordLike),
      });
    }
    return out;
  }

  const re = /(\s+|[^\w'-]+|[\w'-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence))) {
    const text = m[0];
    out.push({
      text,
      start: m.index,
      end: m.index + text.length,
      isWord: /\w/.test(text),
    });
  }
  return out;
}

export function spanFromTokens(
  tokens: Token[],
  selectedIdx: Set<number>,
): { start: number; end: number } | null {
  if (selectedIdx.size === 0) return null;
  const idx = [...selectedIdx].sort((a, b) => a - b);
  const first = idx[0]!;
  const last = idx[idx.length - 1]!;
  // Contiguous check (Mode B requires single span — F-1.5).
  for (let i = 0; i < idx.length - 1; i++) {
    let next = idx[i]! + 1;
    while (next < tokens.length && !tokens[next]!.isWord) next++;
    if (next !== idx[i + 1]) return null;
  }
  return { start: tokens[first]!.start, end: tokens[last]!.end };
}
