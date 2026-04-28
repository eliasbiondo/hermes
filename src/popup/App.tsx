import { useEffect, useMemo, useState } from 'react';
import { queryCards, listDomains, type CardFilter } from '@/lib/storage/card-queries';
import { deleteCards } from '@/lib/storage/db';
import { play } from '@/lib/tts/playback';
import type { Card } from '@/types/card';
import type { PendingRunSummary } from '@/types/messages';

export default function App() {
  const [cards, setCards] = useState<Card[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [filter, setFilter] = useState<CardFilter>({ sort: 'recent' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refreshAt, setRefreshAt] = useState(0);
  const [pending, setPending] = useState<PendingRunSummary[]>([]);
  const [exportState, setExportState] = useState<
    | { kind: 'idle' }
    | { kind: 'busy' }
    | { kind: 'ok'; message: string }
    | { kind: 'err'; message: string }
  >({ kind: 'idle' });

  useEffect(() => {
    void queryCards(filter).then(setCards);
    void listDomains().then(setDomains);
  }, [filter, refreshAt]);

  useEffect(() => {
    void chrome.runtime
      .sendMessage({ kind: 'list-pending-runs' })
      .then((res: { runs?: PendingRunSummary[] } | undefined) => {
        if (res?.runs) setPending(res.runs);
      })
      .catch(() => undefined);

    const onMsg = (msg: { kind?: string; runs?: PendingRunSummary[] }) => {
      if (msg.kind === 'pending-runs' && msg.runs) setPending(msg.runs);
      if (msg.kind === 'cards-changed') setRefreshAt(Date.now());
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, []);

  const stats = useMemo(
    () => ({
      total: cards.length,
      exported: cards.filter((c) => c.exportedAt).length,
    }),
    [cards],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = cards.length > 0 && cards.every((c) => selected.has(c.id));
  const unexportedIds = useMemo(() => cards.filter((c) => !c.exportedAt).map((c) => c.id), [cards]);
  const allUnexportedSelected =
    unexportedIds.length > 0 && unexportedIds.every((id) => selected.has(id));

  const selectAll = () => {
    setSelected(allSelected ? new Set() : new Set(cards.map((c) => c.id)));
  };
  const selectUnexported = () => {
    setSelected(allUnexportedSelected ? new Set() : new Set(unexportedIds));
  };
  const clearSelection = () => setSelected(new Set());

  const onBulkDelete = async () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} card(s)?`)) return;
    await deleteCards([...selected]);
    setSelected(new Set());
    setRefreshAt(Date.now());
  };

  const onExport = async () => {
    setExportState({ kind: 'busy' });
    try {
      const res = (await chrome.runtime.sendMessage({
        kind: 'export-anki',
        scope: selected.size ? 'filter' : 'pending',
        filterIds: selected.size ? [...selected] : undefined,
      })) as { ok: true; filename: string; count: number } | { ok: false; error: string } | undefined;
      if (!res) {
        setExportState({ kind: 'err', message: 'No response from background.' });
      } else if (res.ok) {
        setExportState({ kind: 'ok', message: `Saved ${res.filename} (${res.count} cards).` });
        setRefreshAt(Date.now());
      } else {
        setExportState({ kind: 'err', message: res.error });
      }
    } catch (e) {
      setExportState({ kind: 'err', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <main className="popup">
      <header className="popup__header">
        <h1>Hermes</h1>
        <div className="popup__header-actions">
          <button type="button" onClick={() => chrome.runtime.openOptionsPage()}>
            Settings
          </button>
        </div>
      </header>

      <div className="popup__stats">
        <span>{stats.total} cards</span>
        <span>·</span>
        <span>{stats.exported} exported</span>
        {pending.length > 0 && (
          <>
            <span>·</span>
            <span className="popup__stats-pending">{pending.length} processing</span>
          </>
        )}
        {selected.size > 0 && (
          <>
            <span>·</span>
            <span className="popup__stats-selected">{selected.size} selected</span>
          </>
        )}
      </div>

      {cards.length > 0 && (
        <div className="popup__bulk" role="toolbar" aria-label="Bulk selection">
          <button
            type="button"
            onClick={selectAll}
            aria-pressed={allSelected}
            title="Select / deselect every visible card"
          >
            {allSelected ? 'Clear all' : `Select all (${cards.length})`}
          </button>
          <button
            type="button"
            onClick={selectUnexported}
            aria-pressed={allUnexportedSelected}
            disabled={unexportedIds.length === 0}
            title="Select / deselect every card not yet exported to Anki"
          >
            {allUnexportedSelected
              ? 'Clear unexported'
              : `Select unexported (${unexportedIds.length})`}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={selected.size === 0}
            title="Deselect every card"
          >
            Clear ({selected.size})
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <section className="popup__pending" aria-label="Processing queue">
          <h2 className="popup__pending-title">Processing</h2>
          <ul className="popup__pending-list">
            {pending.map((p) => {
              const elapsed = Math.max(0, Date.now() - p.startedAt);
              const lastTool = p.toolCalls[p.toolCalls.length - 1];
              return (
                <li key={p.runId} className="popup__pending-item">
                  <div className="popup__pending-term">
                    <span className="popup__pending-spinner" aria-hidden="true" />
                    <strong>{p.term}</strong>
                    <span className="popup__pending-mode">{p.mode === 'A_generated' ? 'A' : 'B'}</span>
                  </div>
                  <div className="popup__pending-meta">
                    {p.toolCalls.length}/6 steps
                    {lastTool ? ` · last: ${lastTool.name}` : ''}
                    {' · '}
                    {(elapsed / 1000).toFixed(0)}s
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="popup__filters">
        <input
          type="search"
          placeholder="Search…"
          value={filter.search ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value || undefined }))}
        />
        <select
          value={filter.type ?? ''}
          onChange={(e) =>
            setFilter((f) => ({
              ...f,
              type: (e.target.value || undefined) as Card['type'] | undefined,
            }))
          }
        >
          <option value="">All types</option>
          <option value="word">Word</option>
          <option value="phrasal_verb">Phrasal verb</option>
        </select>
        <select
          value={filter.exported ?? ''}
          onChange={(e) =>
            setFilter((f) => ({
              ...f,
              exported: (e.target.value || undefined) as 'yes' | 'no' | undefined,
            }))
          }
        >
          <option value="">All</option>
          <option value="no">Not exported</option>
          <option value="yes">Exported</option>
        </select>
        {domains.length > 0 && (
          <select
            value={filter.domain ?? ''}
            onChange={(e) =>
              setFilter((f) => ({ ...f, domain: e.target.value || undefined }))
            }
          >
            <option value="">All sources</option>
            {domains.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
        <select
          value={filter.sort ?? 'recent'}
          onChange={(e) =>
            setFilter((f) => ({ ...f, sort: e.target.value as 'recent' | 'alpha' }))
          }
        >
          <option value="recent">Most recent</option>
          <option value="alpha">A → Z</option>
        </select>
      </div>

      {cards.length === 0 ? (
        <section className="popup__empty">
          <p>No cards yet.</p>
          <p className="popup__hint">
            Select English text on any page, then right-click → <em>Add to Hermes</em>.
          </p>
        </section>
      ) : (
        <ul className="popup__list">
          {cards.map((c) => (
            <li key={c.id} className={selected.has(c.id) ? 'is-selected' : ''}>
              <label className="popup__check">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
              </label>
              <div className="popup__card-body">
                <div className="popup__card-term">
                  {c.term}
                  <span className="popup__card-type">{c.type === 'phrasal_verb' ? 'PV' : ''}</span>
                </div>
                <div className="popup__card-tx">{c.termTranslation || '…'}</div>
                {c.sentence && <div className="popup__card-sentence">{c.sentence}</div>}
              </div>
              <div className="popup__card-actions">
                {c.sentenceAudioBlobId && (
                  <button
                    type="button"
                    aria-label="Play"
                    onClick={() => void play(c.sentenceAudioBlobId)}
                  >
                    ▶
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Edit"
                  onClick={() =>
                    chrome.tabs.create({
                      url: chrome.runtime.getURL(`src/edit/index.html?id=${c.id}`),
                    })
                  }
                >
                  ✎
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="popup__footer">
        <button
          type="button"
          disabled={!selected.size}
          onClick={() => void onBulkDelete()}
        >
          Delete ({selected.size})
        </button>
        <button
          type="button"
          className="is-primary"
          onClick={() => void onExport()}
          disabled={exportState.kind === 'busy'}
        >
          {exportState.kind === 'busy'
            ? 'Exporting…'
            : `Export ${selected.size ? `${selected.size} ` : ''}to Anki`}
        </button>
      </footer>
      {exportState.kind === 'ok' && (
        <p className="popup__export-msg is-ok" role="status">{exportState.message}</p>
      )}
      {exportState.kind === 'err' && (
        <p className="popup__export-msg is-err" role="alert">Export failed: {exportState.message}</p>
      )}
    </main>
  );
}
