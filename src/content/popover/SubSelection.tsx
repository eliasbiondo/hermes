// Mode B sub-selection (F-1.5): renders the captured sentence token-by-token
// and lets the user highlight a contiguous span as the term. Click-drag to
// span; click to toggle individual tokens; warns on discontiguous selection.

import { useMemo, useRef, useState } from 'react';
import { spanFromTokens, tokenize } from '@/lib/text/sentence';
import type { HighlightSpan } from '@/types/card';

interface Props {
  sentence: string;
  preselect?: HighlightSpan;
  onConfirm: (termSpan: HighlightSpan) => void;
  onBack: () => void;
}

export function SubSelection({ sentence, preselect, onConfirm, onBack }: Props) {
  const tokens = useMemo(() => tokenize(sentence), [sentence]);
  const wordIdxs = useMemo(
    () => tokens.map((t, i) => (t.isWord ? i : -1)).filter((i) => i >= 0),
    [tokens],
  );

  const [selected, setSelected] = useState<Set<number>>(() => {
    const s = new Set<number>();
    if (preselect) {
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]!;
        if (t.isWord && t.start >= preselect.start && t.end <= preselect.end) s.add(i);
      }
    }
    return s;
  });

  const dragging = useRef<{ anchor: number } | null>(null);

  const span = spanFromTokens(tokens, selected);
  const discontig = selected.size > 0 && span === null;

  const toggle = (idx: number, additive = false) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (additive) {
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
      } else {
        next.clear();
        next.add(idx);
      }
      return next;
    });
  };

  const setRange = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const next = new Set<number>();
    for (const i of wordIdxs) if (i >= lo && i <= hi) next.add(i);
    setSelected(next);
  };

  return (
    <section className="hermes-popover__step">
      <p className="hermes-popover__hint">
        Click or drag across the term you want on the card.
      </p>

      <div
        className="hermes-tokens"
        onMouseUp={() => (dragging.current = null)}
        onMouseLeave={() => (dragging.current = null)}
      >
        {tokens.map((t, i) =>
          t.isWord ? (
            <span
              key={i}
              className={`hermes-token${selected.has(i) ? ' is-selected' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                if (e.shiftKey || e.metaKey || e.ctrlKey) {
                  toggle(i, true);
                } else {
                  dragging.current = { anchor: i };
                  setRange(i, i);
                }
              }}
              onMouseEnter={() => {
                if (dragging.current) setRange(dragging.current.anchor, i);
              }}
            >
              {t.text}
            </span>
          ) : (
            <span key={i} className="hermes-sep">{t.text}</span>
          ),
        )}
      </div>

      {discontig && (
        <p className="hermes-popover__warn" role="alert">
          Pick a single contiguous span — Anki only highlights one range.
        </p>
      )}

      <footer className="hermes-popover__footer">
        <button type="button" onClick={onBack}>← Back</button>
        <button
          type="button"
          className="is-primary"
          disabled={!span || discontig}
          onClick={() => span && onConfirm(span)}
        >
          Use this term
        </button>
      </footer>
    </section>
  );
}
