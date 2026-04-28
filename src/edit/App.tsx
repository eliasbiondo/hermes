import { useEffect, useState } from 'react';
import { getCard, saveCard, deleteCards } from '@/lib/storage/db';
import { play } from '@/lib/tts/playback';
import { highlightHTML } from '@/anki/render';
import type { Card, HighlightSpan, TermType } from '@/types/card';
import { HighlightEditor } from './HighlightEditor';

const params = new URLSearchParams(location.search);
const cardId = params.get('id');

export default function App() {
  const [card, setCard] = useState<Card | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!cardId) return;
    void getCard(cardId).then((c) => setCard(c ?? null));
  }, []);

  if (!cardId) return <main className="edit"><p>Missing card id.</p></main>;
  if (!card) return <main className="edit"><p>Loading…</p></main>;

  const update = (patch: Partial<Card>) => {
    setCard((c) => (c ? { ...c, ...patch } : c));
    setDirty(true);
  };

  const onSave = async () => {
    await saveCard({ ...card, dirtySinceExport: true });
    setDirty(false);
    setSavedAt(Date.now());
  };

  const onDelete = async () => {
    if (!confirm(`Delete "${card.term}"?`)) return;
    await deleteCards([card.id]);
    window.close();
  };

  const onRegenerate = () => {
    chrome.runtime.sendMessage({
      kind: 'regenerate',
      cardId: card.id,
      scope: 'all',
    });
  };

  const onRegenerateTranslation = () => {
    chrome.runtime.sendMessage({
      kind: 'regenerate',
      cardId: card.id,
      scope: 'translation',
    });
  };

  return (
    <main className="edit">
      <header className="edit__header">
        <div>
          <h1>{card.term}</h1>
          <p className="edit__meta">
            Captured {new Date(card.source.capturedAt).toLocaleString()} ·{' '}
            <a href={card.source.url} target="_blank" rel="noreferrer">{hostname(card.source.url)}</a>
          </p>
        </div>
        <div className="edit__header-actions">
          {dirty ? <span className="edit__dirty">Unsaved</span> : null}
          {savedAt && !dirty ? <span className="is-ok">Saved</span> : null}
          <button type="button" onClick={onDelete}>Delete</button>
          <button type="button" className="is-primary" onClick={() => void onSave()} disabled={!dirty}>
            Save
          </button>
        </div>
      </header>

      <section className="edit__section">
        <h2>Front</h2>
        <label className="edit__field">
          <span>Sentence</span>
          <textarea
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
        </label>
        <HighlightEditor
          label="Drag to set the highlighted term:"
          text={card.sentence}
          span={card.sentenceHighlight}
          onChange={(sentenceHighlight) => update({ sentenceHighlight })}
        />
        <div className="edit__preview" aria-label="Front preview">
          <div className="card-preview"
            dangerouslySetInnerHTML={{ __html: highlightHTML(card.sentence, card.sentenceHighlight) }} />
          {card.sentenceAudioBlobId && (
            <button type="button" onClick={() => void play(card.sentenceAudioBlobId)} aria-label="Play sentence">▶︎</button>
          )}
        </div>
      </section>

      <section className="edit__section">
        <h2>Back</h2>
        <label className="edit__field">
          <span>Translation</span>
          <textarea
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
        </label>
        <HighlightEditor
          label="Drag to set the highlighted term in the translation:"
          text={card.sentenceTranslation}
          span={card.sentenceTranslationHighlight}
          onChange={(sentenceTranslationHighlight) => update({ sentenceTranslationHighlight })}
        />
        <div className="edit__preview" aria-label="Back preview">
          <div className="card-preview"
            dangerouslySetInnerHTML={{
              __html: highlightHTML(card.sentenceTranslation, card.sentenceTranslationHighlight),
            }} />
        </div>
      </section>

      <section className="edit__section edit__grid">
        <label className="edit__field">
          <span>Term</span>
          <input
            type="text"
            value={card.term}
            onChange={(e) => update({ term: e.target.value })}
          />
        </label>
        <label className="edit__field">
          <span>Term translation</span>
          <input
            type="text"
            value={card.termTranslation}
            onChange={(e) => update({ termTranslation: e.target.value })}
          />
        </label>
        <label className="edit__field">
          <span>Type</span>
          <select
            value={card.type}
            onChange={(e) => update({ type: e.target.value as TermType })}
          >
            <option value="word">Word</option>
            <option value="phrasal_verb">Phrasal verb</option>
          </select>
        </label>
        <label className="edit__field">
          <span>Tags</span>
          <input
            type="text"
            value={card.tags.join(', ')}
            onChange={(e) =>
              update({
                tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
              })
            }
          />
        </label>
      </section>

      <section className="edit__section">
        <h2>Audio</h2>
        <div className="edit__audio">
          <span>Sentence:</span>
          {card.sentenceAudioBlobId ? (
            <button type="button" onClick={() => void play(card.sentenceAudioBlobId)}>▶︎ play</button>
          ) : (
            <span className="is-err">missing</span>
          )}
        </div>
        <div className="edit__audio">
          <span>Term:</span>
          {card.termAudioBlobId ? (
            <button type="button" onClick={() => void play(card.termAudioBlobId!)}>▶︎ play</button>
          ) : (
            <span className="edit__hint">none — toggle in settings to generate term audio</span>
          )}
        </div>
      </section>

      <section className="edit__section">
        <h2>Regenerate</h2>
        <p className="edit__hint">F-2.8: re-run the full agent or only the translation pass.</p>
        <div className="edit__actions">
          <button type="button" onClick={onRegenerate}>Regenerate everything</button>
          <button type="button" onClick={onRegenerateTranslation}>Regenerate translation only</button>
        </div>
      </section>
    </main>
  );
}

function clampSpan(span: HighlightSpan, max: number): HighlightSpan {
  return { start: Math.min(span.start, max), end: Math.min(span.end, max) };
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}
