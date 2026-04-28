import { useEffect, useMemo, useState } from 'react';
import { getCard, saveCard, deleteCards } from '@/lib/storage/db';
import { play } from '@/lib/tts/playback';
import { highlightHTML } from '@/anki/render';
import type { Card, HighlightSpan, TermType } from '@/types/card';
import { HighlightEditor } from './HighlightEditor';

const params = new URLSearchParams(location.search);
const cardId = params.get('id');

export default function App() {
  const [card, setCard] = useState<Card | null>(null);
  const [missing, setMissing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [previewSide, setPreviewSide] = useState<'front' | 'back'>('front');
  const [regenStatus, setRegenStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!cardId) {
      setMissing(true);
      return;
    }
    void getCard(cardId).then((c) => {
      if (!c) setMissing(true);
      else setCard(c);
    });
  }, []);

  if (!cardId || missing) {
    return (
      <main className="edit">
        <div className="edit__error">
          <p>{!cardId ? 'No card selected.' : 'This card no longer exists.'}</p>
          <button type="button" className="edit__btn" onClick={() => window.close()}>
            Close
          </button>
        </div>
      </main>
    );
  }

  if (!card) {
    return (
      <main className="edit">
        <div className="edit__loading">Loading…</div>
      </main>
    );
  }

  const update = (patch: Partial<Card>) => {
    setCard((c) => (c ? { ...c, ...patch } : c));
    setDirty(true);
  };

  const onSave = async () => {
    await saveCard({ ...card, dirtySinceExport: Boolean(card.exportedAt) });
    setDirty(false);
    setSavedAt(Date.now());
    window.setTimeout(() => setSavedAt(null), 2000);
  };

  const onDelete = async () => {
    if (!confirm(`Delete "${card.term}"? This cannot be undone.`)) return;
    await deleteCards([card.id]);
    window.close();
  };

  const onRegenerate = (scope: 'all' | 'translation') => {
    setRegenStatus(scope === 'all' ? 'Regenerating…' : 'Regenerating translation…');
    chrome.runtime.sendMessage({
      kind: 'regenerate',
      cardId: card.id,
      scope,
    });
    window.setTimeout(() => setRegenStatus(null), 4000);
  };

  return (
    <main className="edit">
      <header className="edit__header">
        <div className="edit__header-row">
          <h1>{card.term}</h1>
          <div className="edit__header-actions">
            {dirty && (
              <span className="edit__status is-dirty">
                <span className="edit__status-dot" /> Unsaved
              </span>
            )}
            {!dirty && savedAt && (
              <span className="edit__status is-saved">
                <span className="edit__status-dot" /> Saved
              </span>
            )}
            <button type="button" className="edit__btn edit__btn--danger" onClick={onDelete}>
              Delete
            </button>
            <button
              type="button"
              className="edit__btn edit__btn--primary"
              onClick={() => void onSave()}
              disabled={!dirty}
            >
              Save changes
            </button>
          </div>
        </div>
        <p className="edit__meta">
          {card.type === 'phrasal_verb' && (
            <span className="edit__chip is-pv">Phrasal verb</span>
          )}
          {card.exportedAt && !card.dirtySinceExport && (
            <span className="edit__chip is-exported">Exported</span>
          )}
          {card.dirtySinceExport && (
            <span className="edit__chip is-dirty">Edited since export</span>
          )}
          <span>Captured {new Date(card.source.capturedAt).toLocaleString()}</span>
          {hostname(card.source.url) && (
            <>
              <span aria-hidden="true">·</span>
              <a href={card.source.url} target="_blank" rel="noreferrer">
                {hostname(card.source.url)}
              </a>
            </>
          )}
        </p>
      </header>

      <div className="edit__layout">
        <div>
          <section className="edit__section">
            <h2>Front · sentence</h2>
            <p className="edit__section-hint">
              The sentence shown when the card flips up. Highlight the term Anki will mark.
            </p>
            <div className="edit__field">
              <span className="edit__field-label">Sentence</span>
              <textarea
                className="edit__textarea"
                rows={2}
                value={card.sentence}
                onChange={(e) => {
                  const next = e.target.value;
                  update({
                    sentence: next,
                    sentenceHighlight: clampSpan(card.sentenceHighlight, next.length),
                  });
                }}
              />
            </div>
            <HighlightEditor
              label="Click or drag tokens to set the highlight."
              text={card.sentence}
              span={card.sentenceHighlight}
              onChange={(sentenceHighlight) => update({ sentenceHighlight })}
            />
          </section>

          <section className="edit__section">
            <h2>Back · PT-BR translation</h2>
            <p className="edit__section-hint">
              The translation revealed on flip. Highlight the term that conveys the meaning.
            </p>
            <div className="edit__field">
              <span className="edit__field-label">Translation</span>
              <textarea
                className="edit__textarea"
                rows={2}
                value={card.sentenceTranslation}
                onChange={(e) => {
                  const next = e.target.value;
                  update({
                    sentenceTranslation: next,
                    sentenceTranslationHighlight: clampSpan(
                      card.sentenceTranslationHighlight,
                      next.length,
                    ),
                  });
                }}
              />
            </div>
            <HighlightEditor
              label="Click or drag tokens to set the translated highlight."
              text={card.sentenceTranslation}
              span={card.sentenceTranslationHighlight}
              onChange={(sentenceTranslationHighlight) => update({ sentenceTranslationHighlight })}
            />
          </section>

          <section className="edit__section">
            <h2>Term details</h2>
            <p className="edit__section-hint">
              Used on the back of the card and for sorting in your deck.
            </p>
            <div className="edit__grid">
              <div className="edit__field">
                <span className="edit__field-label">Term (EN)</span>
                <input
                  type="text"
                  className="edit__input"
                  value={card.term}
                  onChange={(e) => update({ term: e.target.value })}
                />
              </div>
              <div className="edit__field">
                <span className="edit__field-label">Term translation (PT)</span>
                <input
                  type="text"
                  className="edit__input"
                  value={card.termTranslation}
                  onChange={(e) => update({ termTranslation: e.target.value })}
                />
              </div>
              <div className="edit__field">
                <span className="edit__field-label">Type</span>
                <select
                  className="edit__select"
                  value={card.type}
                  onChange={(e) => update({ type: e.target.value as TermType })}
                >
                  <option value="word">Word</option>
                  <option value="phrasal_verb">Phrasal verb</option>
                </select>
              </div>
              <div className="edit__field">
                <span className="edit__field-label">Tags</span>
                <input
                  type="text"
                  className="edit__input"
                  placeholder="Comma-separated"
                  value={card.tags.join(', ')}
                  onChange={(e) =>
                    update({
                      tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                    })
                  }
                />
              </div>
            </div>
          </section>

          <section className="edit__section">
            <h2>Audio</h2>
            <div className="edit__audio-row">
              <span className="edit__audio-label">
                <strong>Sentence</strong>
                <span className="edit__audio-missing">— autoplays on card front</span>
              </span>
              {card.sentenceAudioBlobId ? (
                <button
                  type="button"
                  className="edit__btn"
                  onClick={() => void play(card.sentenceAudioBlobId)}
                >
                  <PlayIcon /> Play
                </button>
              ) : (
                <span className="edit__audio-missing is-err">Missing</span>
              )}
            </div>
            <div className="edit__audio-row">
              <span className="edit__audio-label">
                <strong>Term</strong>
                <span className="edit__audio-missing">— optional, plays on flip</span>
              </span>
              {card.termAudioBlobId ? (
                <button
                  type="button"
                  className="edit__btn"
                  onClick={() => void play(card.termAudioBlobId!)}
                >
                  <PlayIcon /> Play
                </button>
              ) : (
                <span className="edit__audio-missing">Not generated</span>
              )}
            </div>
          </section>

          <section className="edit__section">
            <h2>Regenerate</h2>
            <p className="edit__section-hint">
              Re-run the AI pipeline if the result needs improvement. Changes overwrite the
              current values.
            </p>
            <div className="edit__regen-actions">
              <button type="button" className="edit__btn" onClick={() => onRegenerate('all')}>
                Regenerate everything
              </button>
              <button type="button" className="edit__btn" onClick={() => onRegenerate('translation')}>
                Translation only
              </button>
              {regenStatus && (
                <span className="edit__status is-dirty">
                  <span className="edit__status-dot" /> {regenStatus}
                </span>
              )}
            </div>
          </section>
        </div>

        {/* Live preview */}
        <aside className="edit__preview" aria-label="Card preview">
          <div className="edit__preview-tabs">
            <button
              type="button"
              className={`edit__preview-tab${previewSide === 'front' ? ' is-active' : ''}`}
              onClick={() => setPreviewSide('front')}
            >
              Front
            </button>
            <button
              type="button"
              className={`edit__preview-tab${previewSide === 'back' ? ' is-active' : ''}`}
              onClick={() => setPreviewSide('back')}
            >
              Back
            </button>
          </div>
          <div className="edit__preview-body">
            {previewSide === 'front' ? (
              <FrontPreview card={card} />
            ) : (
              <BackPreview card={card} />
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function FrontPreview({ card }: { card: Card }) {
  const html = useMemo(
    () => highlightHTML(card.sentence, card.sentenceHighlight),
    [card.sentence, card.sentenceHighlight],
  );

  if (!card.sentence.trim()) {
    return <div className="edit__preview-empty">Add a sentence to see the preview.</div>;
  }

  return (
    <>
      <div
        className="edit__preview-sentence"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="edit__preview-actions">
        {card.sentenceAudioBlobId ? (
          <button
            type="button"
            className="edit__preview-play"
            onClick={() => void play(card.sentenceAudioBlobId)}
            aria-label="Play sentence audio"
          >
            <PlayIcon size={16} />
          </button>
        ) : (
          <span className="edit__preview-empty">Audio not yet generated.</span>
        )}
      </div>
    </>
  );
}

function BackPreview({ card }: { card: Card }) {
  const sentenceHtml = useMemo(
    () => highlightHTML(card.sentence, card.sentenceHighlight),
    [card.sentence, card.sentenceHighlight],
  );
  const translationHtml = useMemo(
    () => highlightHTML(card.sentenceTranslation, card.sentenceTranslationHighlight),
    [card.sentenceTranslation, card.sentenceTranslationHighlight],
  );

  if (!card.sentence.trim()) {
    return <div className="edit__preview-empty">Add a sentence to see the preview.</div>;
  }

  return (
    <>
      <div
        className="edit__preview-sentence"
        dangerouslySetInnerHTML={{ __html: sentenceHtml }}
      />
      <div className="edit__preview-divider" />
      <div
        className="edit__preview-translation"
        dangerouslySetInnerHTML={{ __html: translationHtml }}
      />
      <div className="edit__preview-pair">
        <strong>{card.term}</strong> → <strong>{card.termTranslation || '…'}</strong>
      </div>
      {card.termAudioBlobId && (
        <div className="edit__preview-actions">
          <button
            type="button"
            className="edit__preview-play"
            onClick={() => void play(card.termAudioBlobId!)}
            aria-label="Play term audio"
          >
            <PlayIcon size={16} />
          </button>
        </div>
      )}
    </>
  );
}

function clampSpan(span: HighlightSpan, max: number): HighlightSpan {
  return { start: Math.min(span.start, max), end: Math.min(span.end, max) };
}

function hostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

function PlayIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.55.83l10.31-6.86a1 1 0 0 0 0-1.66L9.55 4.31A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}
