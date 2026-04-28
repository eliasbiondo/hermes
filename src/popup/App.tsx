import { useEffect, useMemo, useRef, useState } from 'react';
import { Select } from '@/components/Select';
import { Checkbox } from '@/components/Checkbox';
import { queryCards, listDomains, type CardFilter } from '@/lib/storage/card-queries';
import { deleteCards } from '@/lib/storage/db';
import { play } from '@/lib/tts/playback';
import { highlightHTML } from '@/anki/render';
import { loadSettings } from '@/lib/storage/settings-store';
import { hasRequiredKeys } from '@/types/settings';
import type { Card } from '@/types/card';
import type { PendingRunSummary } from '@/types/messages';

type Tab = 'library' | 'archive' | 'queue';

interface ExportState {
  kind: 'idle' | 'busy' | 'ok' | 'err';
  message?: string;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('library');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | 'word' | 'phrasal_verb'>('');
  const [domainFilter, setDomainFilter] = useState('');
  const [sort, setSort] = useState<'recent' | 'alpha'>('recent');

  const [libraryCards, setLibraryCards] = useState<Card[]>([]);
  const [archiveCards, setArchiveCards] = useState<Card[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingRunSummary[]>([]);
  const [refreshAt, setRefreshAt] = useState(0);
  const [now, setNow] = useState(Date.now());

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });
  const [toast, setToast] = useState<string | null>(null);
  const [keysOk, setKeysOk] = useState(true);

  const toastT = useRef<number | undefined>(undefined);

  // Build the live query filter shape for the active tab.
  const filter: CardFilter = useMemo(() => {
    const base: CardFilter = { sort };
    if (search.trim()) base.search = search.trim();
    if (typeFilter) base.type = typeFilter;
    if (domainFilter) base.domain = domainFilter;
    return base;
  }, [search, typeFilter, domainFilter, sort]);

  useEffect(() => {
    void loadSettings().then((s) => setKeysOk(hasRequiredKeys(s)));
  }, [refreshAt]);

  useEffect(() => {
    void queryCards({ ...filter, exported: 'no' }).then(setLibraryCards);
    void queryCards({ ...filter, exported: 'yes' }).then(setArchiveCards);
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

  // Tick the elapsed timer for the queue panel.
  useEffect(() => {
    if (!pending.length) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [pending.length]);

  // Reset selection when switching tabs to avoid acting on hidden items.
  useEffect(() => { setSelected(new Set()); }, [tab]);

  const visibleCards = tab === 'archive' ? archiveCards : libraryCards;

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastT.current) window.clearTimeout(toastT.current);
    toastT.current = window.setTimeout(() => setToast(null), 2200);
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected =
    visibleCards.length > 0 && visibleCards.every((c) => selected.has(c.id));

  const toggleAllVisible = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(visibleCards.map((c) => c.id)));
  };

  const onBulkDelete = async () => {
    if (!selected.size) return;
    const phrase = selected.size === 1 ? 'this card' : `these ${selected.size} cards`;
    if (!confirm(`Delete ${phrase}? This cannot be undone.`)) return;
    await deleteCards([...selected]);
    showToast(`Deleted ${selected.size}`);
    setSelected(new Set());
    setRefreshAt(Date.now());
  };

  const onExport = async (scope: 'pending' | 'selected' | 'all') => {
    setExportState({ kind: 'busy' });
    try {
      const filterIds =
        scope === 'selected'
          ? [...selected]
          : scope === 'all'
            ? [...libraryCards, ...archiveCards].map((c) => c.id)
            : undefined;
      const res = (await chrome.runtime.sendMessage({
        kind: 'export-anki',
        scope: scope === 'selected' || scope === 'all' ? 'filter' : 'pending',
        filterIds,
      })) as { ok: true; filename: string; count: number } | { ok: false; error: string } | undefined;
      if (!res) {
        setExportState({ kind: 'err', message: 'No response from background.' });
      } else if (res.ok) {
        setExportState({
          kind: 'ok',
          message: `Saved ${res.filename} — ${res.count} card${res.count === 1 ? '' : 's'}.`,
        });
        setRefreshAt(Date.now());
        setSelected(new Set());
      } else {
        setExportState({ kind: 'err', message: res.error });
      }
    } catch (e) {
      setExportState({ kind: 'err', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const exportTarget: 'pending' | 'selected' | 'all' =
    selected.size > 0 ? 'selected' : tab === 'archive' ? 'all' : 'pending';

  const exportLabel = (() => {
    if (exportState.kind === 'busy') return 'Exporting…';
    if (exportTarget === 'selected') return `Export ${selected.size} to Anki`;
    if (exportTarget === 'all') return 'Re-export all to Anki';
    const n = libraryCards.length;
    return n === 0 ? 'Nothing to export' : `Export ${n} to Anki`;
  })();

  const exportDisabled =
    exportState.kind === 'busy' ||
    (exportTarget === 'pending' && libraryCards.length === 0);

  return (
    <main className="popup">
      <header className="popup__header">
        <div className="popup__brand">
          <BrandIcon />
          <h1 className="popup__title">Hermes</h1>
        </div>
        <button
          type="button"
          className="popup__icon-btn"
          aria-label="Settings"
          title="Settings"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          <SettingsIcon />
        </button>
      </header>

      <nav className="popup__tabs" role="tablist" aria-label="Card sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'library'}
          className={`popup__tab${tab === 'library' ? ' is-active' : ''}`}
          onClick={() => setTab('library')}
        >
          Library
          <span className="popup__tab-count">{libraryCards.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'archive'}
          className={`popup__tab${tab === 'archive' ? ' is-active' : ''}`}
          onClick={() => setTab('archive')}
        >
          Archive
          <span className="popup__tab-count">{archiveCards.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'queue'}
          className={`popup__tab${tab === 'queue' ? ' is-active' : ''}`}
          onClick={() => setTab('queue')}
        >
          Queue
          <span className={`popup__tab-count${pending.length ? ' is-live' : ''}`}>
            {pending.length}
          </span>
        </button>
      </nav>

      <div className="popup__body">
        {!keysOk && (
          <div className="popup__alert" role="status">
            <div className="popup__alert-title">Capture is paused</div>
            Add an LLM key and pick a TTS option to start saving cards.
            <div>
              <button type="button" onClick={() => chrome.runtime.openOptionsPage()}>
                Open settings
              </button>
            </div>
          </div>
        )}

        {tab !== 'queue' && (
          <>
            <div className="popup__filters">
              <label className="popup__search" aria-label="Search cards">
                <span className="popup__search-icon" aria-hidden="true">
                  <SearchIcon />
                </span>
                <input
                  type="search"
                  placeholder={
                    tab === 'archive'
                      ? 'Search archive…'
                      : 'Search by term, sentence, or translation'
                  }
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="popup__filter-chips">
                <Select
                  size="sm"
                  variant="chip"
                  width="auto"
                  ariaLabel="Type filter"
                  value={typeFilter}
                  onChange={(v) => setTypeFilter(v as '' | 'word' | 'phrasal_verb')}
                  options={[
                    { value: '', label: 'All types' },
                    { value: 'word', label: 'Words' },
                    { value: 'phrasal_verb', label: 'Phrasal verbs' },
                  ]}
                />
                {domains.length > 0 && (
                  <Select
                    size="sm"
                    variant="chip"
                    width="auto"
                    ariaLabel="Source filter"
                    value={domainFilter}
                    onChange={setDomainFilter}
                    options={[
                      { value: '', label: 'All sources' },
                      ...domains.map((d) => ({ value: d, label: d })),
                    ]}
                  />
                )}
                <Select
                  size="sm"
                  variant="chip"
                  width="auto"
                  ariaLabel="Sort"
                  value={sort}
                  onChange={(v) => setSort(v as 'recent' | 'alpha')}
                  options={[
                    { value: 'recent', label: 'Most recent' },
                    { value: 'alpha', label: 'A → Z' },
                  ]}
                />
              </div>
            </div>

            {visibleCards.length > 0 && (
              <div className="popup__bar">
                <span className="popup__bar-info">
                  <strong>{visibleCards.length}</strong>
                  {tab === 'archive' ? ' exported' : ' to export'}
                  {selected.size > 0 && (
                    <>
                      {' · '}
                      <strong>{selected.size}</strong> selected
                    </>
                  )}
                </span>
                <div className="popup__bar-actions">
                  <button
                    type="button"
                    className="popup__link"
                    onClick={toggleAllVisible}
                  >
                    {allVisibleSelected ? 'Clear selection' : 'Select all'}
                  </button>
                </div>
              </div>
            )}

            {visibleCards.length === 0 ? (
              <EmptyState tab={tab} hasFilter={Boolean(search || typeFilter || domainFilter)} />
            ) : (
              <ul className="popup__list" role="list">
                {visibleCards.map((c) => (
                  <CardRow
                    key={c.id}
                    card={c}
                    selected={selected.has(c.id)}
                    onToggle={() => toggle(c.id)}
                    onPlay={() => void play(c.sentenceAudioBlobId)}
                    onEdit={() =>
                      chrome.tabs.create({
                        url: chrome.runtime.getURL(`src/edit/index.html?id=${c.id}`),
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 'queue' && (
          <QueuePanel pending={pending} now={now} onSwitchToLibrary={() => setTab('library')} />
        )}
      </div>

      {tab !== 'queue' && (
      <footer className="popup__footer">
        {selected.size > 0 ? (
          <div className="popup__footer-actions">
            <button
              type="button"
              className="popup__btn popup__btn--danger"
              onClick={() => void onBulkDelete()}
            >
              Delete {selected.size}
            </button>
            <button
              type="button"
              className="popup__btn popup__btn--primary"
              onClick={() => void onExport('selected')}
              disabled={exportState.kind === 'busy'}
            >
              {exportLabel}
            </button>
          </div>
        ) : (
          <div className="popup__footer-actions">
            <button
              type="button"
              className="popup__btn popup__btn--primary"
              onClick={() =>
                void onExport(tab === 'archive' ? 'all' : 'pending')
              }
              disabled={exportDisabled}
            >
              {exportLabel}
            </button>
          </div>
        )}
        {exportState.kind === 'ok' && (
          <p className="popup__msg is-ok" role="status">
            <span>{exportState.message}</span>
            <button
              type="button"
              className="popup__msg-dismiss"
              onClick={() => setExportState({ kind: 'idle' })}
              aria-label="Dismiss"
            >
              ×
            </button>
          </p>
        )}
        {exportState.kind === 'err' && (
          <p className="popup__msg is-err" role="alert">
            <span>Export failed: {exportState.message}</span>
            <button
              type="button"
              className="popup__msg-dismiss"
              onClick={() => setExportState({ kind: 'idle' })}
              aria-label="Dismiss"
            >
              ×
            </button>
          </p>
        )}
      </footer>
      )}

      {toast && <div className="popup__toast" role="status">{toast}</div>}
    </main>
  );
}

interface CardRowProps {
  card: Card;
  selected: boolean;
  onToggle: () => void;
  onPlay: () => void;
  onEdit: () => void;
}

function CardRow({ card, selected, onToggle, onPlay, onEdit }: CardRowProps) {
  const sentenceHTML = useMemo(
    () => highlightHTML(card.sentence, card.sentenceHighlight),
    [card.sentence, card.sentenceHighlight],
  );

  const onRowClick = (e: React.MouseEvent) => {
    // Click outside controls toggles selection — mirrors typical list UX.
    const target = e.target as HTMLElement;
    if (target.closest('button, input, a')) return;
    onToggle();
  };

  return (
    <li
      className={`popup__card${selected ? ' is-selected' : ''}`}
      onClick={onRowClick}
    >
      <span className="popup__check" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onChange={onToggle}
          ariaLabel={`Select ${card.term}`}
        />
      </span>

      <div className="popup__card-body">
        <div className="popup__card-row">
          <span className="popup__card-term" title={card.term}>{card.term}</span>
          <span className="popup__card-arrow">→</span>
          <span className="popup__card-translation" title={card.termTranslation}>
            {card.termTranslation || '…'}
          </span>
        </div>
        {card.sentence && (
          <div
            className="popup__card-sentence"
            dangerouslySetInnerHTML={{ __html: sentenceHTML }}
          />
        )}
        <div className="popup__card-meta">
          {card.type === 'phrasal_verb' && (
            <span className="popup__badge is-pv">Phrasal verb</span>
          )}
          {card.exportedAt && !card.dirtySinceExport && (
            <span className="popup__badge is-exported">Exported</span>
          )}
          {card.dirtySinceExport && (
            <span className="popup__badge is-dirty">Edited</span>
          )}
          <span>{formatRelative(card.source.capturedAt)}</span>
          {hostnameOf(card.source.url) && (
            <>
              <span aria-hidden="true">·</span>
              <span title={card.source.url}>{hostnameOf(card.source.url)}</span>
            </>
          )}
        </div>
      </div>

      <div className="popup__card-actions">
        {card.sentenceAudioBlobId && (
          <button
            type="button"
            className="popup__action"
            onClick={onPlay}
            aria-label="Play audio"
            title="Play audio"
          >
            <PlayIcon />
          </button>
        )}
        <button
          type="button"
          className="popup__action"
          onClick={onEdit}
          aria-label="Edit card"
          title="Edit card"
        >
          <EditIcon />
        </button>
      </div>
    </li>
  );
}

function EmptyState({ tab, hasFilter }: { tab: Tab; hasFilter: boolean }) {
  if (hasFilter) {
    return (
      <section className="popup__empty">
        <div className="popup__empty-mark" aria-hidden="true">
          <SearchIcon size={20} />
        </div>
        <p className="popup__empty-title">No matches</p>
        <p className="popup__empty-hint">Try a different search or clear the filters.</p>
      </section>
    );
  }
  if (tab === 'archive') {
    return (
      <section className="popup__empty">
        <div className="popup__empty-mark" aria-hidden="true">
          <ArchiveIcon size={20} />
        </div>
        <p className="popup__empty-title">Archive is empty</p>
        <p className="popup__empty-hint">
          Cards land here automatically once you export them to Anki.
        </p>
      </section>
    );
  }
  return (
    <section className="popup__empty">
      <div className="popup__empty-mark" aria-hidden="true">
        <SparkIcon size={20} />
      </div>
      <p className="popup__empty-title">Capture your first card</p>
      <p className="popup__empty-hint">
        Select English text on any page, then right-click <em>Add to Hermes</em>{' '}
        or press <kbd>Ctrl/⌘</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd>.
      </p>
    </section>
  );
}

function QueuePanel({
  pending,
  now,
  onSwitchToLibrary,
}: {
  pending: PendingRunSummary[];
  now: number;
  onSwitchToLibrary: () => void;
}) {
  if (!pending.length) {
    return (
      <section className="popup__empty">
        <div className="popup__empty-mark" aria-hidden="true">
          <CheckIcon size={20} />
        </div>
        <p className="popup__empty-title">Queue is empty</p>
        <p className="popup__empty-hint">
          Live captures appear here while they enrich. Finished cards move to the{' '}
          <button type="button" className="popup__link" onClick={onSwitchToLibrary}>Library</button>.
        </p>
      </section>
    );
  }
  return (
    <section className="popup__queue" aria-label="Processing queue">
      {pending.map((p) => (
        <QueueItem key={p.runId} run={p} now={now} />
      ))}
    </section>
  );
}

function QueueItem({ run, now }: { run: PendingRunSummary; now: number }) {
  const elapsedSec = Math.max(0, Math.floor((now - run.startedAt) / 1000));
  const lastTool = run.toolCalls[run.toolCalls.length - 1];
  const stepLabel = lastTool ? labelForTool(lastTool.name) : 'Starting…';
  // Estimate progress without a fixed step total. The new pipeline runs
  // 2 (or 3) tool calls; we surface that as proportional progress.
  // While the first tool is still running, show indeterminate.
  const indeterminate = run.toolCalls.length === 0;
  const fraction = Math.min(1, run.toolCalls.length / 3);
  return (
    <article className="popup__queue-card">
      <header className="popup__queue-head">
        <div className="popup__queue-term">
          <span className="popup__spinner" aria-hidden="true" />
          <span className="popup__queue-term-text">{run.term}</span>
          <span className="popup__badge">
            {run.mode === 'A_generated' ? 'Generated' : 'Verbatim'}
          </span>
        </div>
        <span className="popup__queue-elapsed" aria-label={`Elapsed ${elapsedSec} seconds`}>
          {elapsedSec}s
        </span>
      </header>
      <div className="popup__queue-progress" aria-hidden="true">
        <div
          className={`popup__queue-progress-fill${indeterminate ? ' is-indeterminate' : ''}`}
          style={indeterminate ? undefined : { width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
      <div className="popup__queue-meta">
        <span className="popup__queue-step">{stepLabel}</span>
        <span>{run.toolCalls.length === 0 ? 'pending' : `step ${run.toolCalls.length}`}</span>
      </div>
    </article>
  );
}

const TOOL_LABELS: Record<string, string> = {
  enrich: 'Enriching context',
  tts_synthesize: 'Synthesizing audio',
  tts_synthesize_term: 'Synthesizing term audio',
};

function labelForTool(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

/* Inline SVG icons — lighter than shipping a font. */

function BrandIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 3 22 21H2L12 3Z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.05A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.05A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.16.39.5.7.92.86.27.1.56.14.83.14H21a2 2 0 1 1 0 4h-.05a1.7 1.7 0 0 0-1.55 1Z" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.55.83l10.31-6.86a1 1 0 0 0 0-1.66L9.55 4.31A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m4 20 4-1 11-11-3-3L5 16l-1 4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m13 6 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ArchiveIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 7h18v4H3z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 11v9h14v-9M10 14h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12 5 5L20 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SparkIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
