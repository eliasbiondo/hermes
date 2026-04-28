// Token-by-token highlight editor (F-4.5). Same UX as the Mode B sub-selection
// in capture popover — drag/click tokens to set a single contiguous span.

import { useMemo, useRef, useState } from 'react';
import { spanFromTokens, tokenize } from '@/lib/text/sentence';
import type { HighlightSpan } from '@/types/card';

export function HighlightEditor({
  text,
  span,
  onChange,
  label,
}: {
  text: string;
  span: HighlightSpan;
  onChange: (next: HighlightSpan) => void;
  label?: string;
}) {
  const tokens = useMemo(() => tokenize(text), [text]);
  const wordIdxs = useMemo(
    () => tokens.map((t, i) => (t.isWord ? i : -1)).filter((i) => i >= 0),
    [tokens],
  );
  const initial = useMemo(() => {
    const s = new Set<number>();
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (t.isWord && t.start >= span.start && t.end <= span.end) s.add(i);
    }
    return s;
  }, [tokens, span.start, span.end]);
  const [selected, setSelected] = useState<Set<number>>(initial);
  const dragging = useRef<{ anchor: number } | null>(null);

  const computed = spanFromTokens(tokens, selected);
  const discontig = selected.size > 0 && computed === null;

  const setRange = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const next = new Set<number>();
    for (const i of wordIdxs) if (i >= lo && i <= hi) next.add(i);
    setSelected(next);
    const sp = spanFromTokens(tokens, next);
    if (sp) onChange(sp);
  };

  return (
    <div className="hl-editor">
      {label && <p className="hl-editor__hint">{label}</p>}
      <div
        className="hl-editor__tokens"
        onMouseUp={() => (dragging.current = null)}
        onMouseLeave={() => (dragging.current = null)}
      >
        {tokens.map((t, i) =>
          t.isWord ? (
            <span
              key={i}
              className={`hl-token${selected.has(i) ? ' is-selected' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                dragging.current = { anchor: i };
                setRange(i, i);
              }}
              onMouseEnter={() => {
                if (dragging.current) setRange(dragging.current.anchor, i);
              }}
            >
              {t.text}
            </span>
          ) : (
            <span key={i} className="hl-sep">{t.text}</span>
          ),
        )}
      </div>
      {discontig && <p className="hl-editor__error">Pick a single contiguous span.</p>}
    </div>
  );
}
