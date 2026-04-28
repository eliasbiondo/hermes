import { useEffect, useMemo, useRef, useState } from 'react';
import { loadSettings, saveSettings } from '@/lib/storage/settings-store';
import { exportCSV, exportJSON, importJSON } from '@/lib/io/json-csv';
import { currentMonth, listMonths, summarizeMonth, type MonthlySummary } from '@/lib/quota/store';
import { getTTS } from '@/lib/tts/factory';
import { hasRequiredKeys, type LLMProvider, type Settings, type TTSProvider } from '@/types/settings';
import {
  ensureLLMPermission,
  ensureTTSPermission,
} from '@/lib/providers/host-permissions';
import { testLLM, testTTS, type TestResult } from '@/lib/providers/test-connection';
import { Select } from '@/components/Select';

interface LLMProviderInfo {
  value: LLMProvider;
  label: string;
  defaultModel: string;
  tag: string;
}

const LLM_PROVIDERS: LLMProviderInfo[] = [
  { value: 'gemini',     label: 'Gemini',     defaultModel: 'gemini-2.5-flash', tag: 'recommended' },
  { value: 'openai',     label: 'OpenAI',     defaultModel: 'gpt-4o',           tag: 'GPT family' },
  { value: 'anthropic',  label: 'Anthropic',  defaultModel: 'claude-sonnet-4-6',tag: 'Claude family' },
  { value: 'openrouter', label: 'OpenRouter', defaultModel: 'openai/gpt-4o',    tag: 'multi-model' },
];

interface TTSProviderInfo {
  value: TTSProvider;
  label: string;
  tag: string;
}

const TTS_PROVIDERS: TTSProviderInfo[] = [
  { value: 'edge',       label: 'Microsoft Edge', tag: 'free · neural' },
  { value: 'elevenlabs', label: 'ElevenLabs',     tag: 'paid · premium' },
  { value: 'browser',    label: 'Browser TTS',    tag: 'free · fallback' },
];

const EDGE_VOICES = [
  { id: 'en-US-AriaNeural',    label: 'Aria — US, female' },
  { id: 'en-US-JennyNeural',   label: 'Jenny — US, female' },
  { id: 'en-US-GuyNeural',     label: 'Guy — US, male' },
  { id: 'en-US-AndrewNeural',  label: 'Andrew — US, male' },
  { id: 'en-US-EmmaNeural',    label: 'Emma — US, female' },
  { id: 'en-GB-SoniaNeural',   label: 'Sonia — UK, female' },
  { id: 'en-GB-RyanNeural',    label: 'Ryan — UK, male' },
];

const SECTION_IDS = [
  'sec-llm',
  'sec-tts',
  'sec-anki',
  'sec-capture',
  'sec-usage',
  'sec-backup',
  'sec-debug',
] as const;

type SectionId = (typeof SECTION_IDS)[number];

const SECTION_LABELS: Record<SectionId, string> = {
  'sec-llm':     'Language model',
  'sec-tts':     'Voice',
  'sec-anki':    'Anki export',
  'sec-capture': 'Capture',
  'sec-usage':   'Usage',
  'sec-backup':  'Backup',
  'sec-debug':   'Developer',
};

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [llmTest, setLlmTest] = useState<TestResult | null>(null);
  const [ttsTest, setTtsTest] = useState<TestResult | null>(null);
  const [llmTesting, setLlmTesting] = useState(false);
  const [ttsTesting, setTtsTesting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewMsg, setPreviewMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [importStatus, setImportStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonth());
  const [usage, setUsage] = useState<MonthlySummary | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>('sec-llm');

  useEffect(() => { void listMonths().then(setMonths); }, [savedAt]);
  useEffect(() => { void summarizeMonth(selectedMonth).then(setUsage); }, [selectedMonth, savedAt]);
  useEffect(() => { void loadSettings().then(setSettings); }, []);

  const monthOptions = useMemo(() => {
    const list = months.length ? months : [selectedMonth];
    return list.map((m) => ({ value: m, label: m }));
  }, [months, selectedMonth]);

  useEffect(() => {
    if (!settings) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveSection(visible.target.id as SectionId);
      },
      { rootMargin: '-15% 0px -65% 0px', threshold: 0 },
    );
    for (const id of SECTION_IDS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [settings]);

  if (!settings) {
    return (
      <main>
        <div className="options__loading">Loading…</div>
      </main>
    );
  }

  const update = async (patch: Partial<Settings>) => {
    const next = await saveSettings(patch);
    setSettings(next);
    setSavedAt(Date.now());
  };

  const onLLMProviderChange = async (provider: LLMProvider) => {
    const def = LLM_PROVIDERS.find((p) => p.value === provider)!;
    await ensureLLMPermission(provider);
    await update({ llm: { ...settings.llm, provider, model: def.defaultModel } });
    setLlmTest(null);
  };

  const onTTSProviderChange = async (provider: TTSProvider) => {
    if (provider !== 'browser') await ensureTTSPermission(provider);
    const voiceId =
      provider === 'edge' ? 'en-US-JennyNeural' :
      provider === 'elevenlabs' ? 'BIvP0GN1cAtSRTxNHnWS' :
      settings.tts.voiceId;
    await update({ tts: { ...settings.tts, provider, voiceId } });
    setTtsTest(null);
  };

  const onTestLLM = async () => {
    setLlmTesting(true);
    setLlmTest(null);
    try {
      const granted = await ensureLLMPermission(settings.llm.provider);
      if (!granted) {
        setLlmTest({ ok: false, latencyMs: 0, message: 'Host permission denied.' });
        return;
      }
      setLlmTest(await testLLM(settings.llm));
    } finally {
      setLlmTesting(false);
    }
  };

  const onTestTTS = async () => {
    setTtsTesting(true);
    setTtsTest(null);
    try {
      const granted = await ensureTTSPermission(settings.tts.provider);
      if (!granted) {
        setTtsTest({ ok: false, latencyMs: 0, message: 'Host permission denied.' });
        return;
      }
      setTtsTest(await testTTS(settings.tts));
    } finally {
      setTtsTesting(false);
    }
  };

  const onPreviewVoice = async () => {
    setPreviewing(true);
    setPreviewMsg(null);
    try {
      const tts = await getTTS(settings.tts);
      const blob = await tts.synthesize(
        'Hello — this is a preview of the selected Hermes voice.',
        settings.tts.voiceId,
      );
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
      await audio.play();
      setPreviewMsg({ kind: 'ok', text: `Played ${(blob.size / 1024).toFixed(1)} KB` });
    } catch (e) {
      setPreviewMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setPreviewing(false);
    }
  };

  const ready = hasRequiredKeys(settings);

  return (
    <>
      <header className="options__topbar">
        <div className="options__topbar-brand">
          <BrandIcon size={14} />
          <span>Hermes</span>
          <span className="options__topbar-sep" aria-hidden="true">/</span>
          <span className="options__topbar-page">Settings</span>
        </div>
        <span
          className={`options__topbar-status ${ready ? 'is-ready' : 'is-blocked'}`}
          role="status"
        >
          <span className="options__topbar-dot" aria-hidden="true" />
          {ready ? 'Capture live' : 'Capture paused'}
        </span>
      </header>

      <main className="options">
        <nav className="options__nav" aria-label="Settings sections">
          <div className="options__nav-heading">Sections</div>
          {SECTION_IDS.map((id) => (
            <a
              key={id}
              href={`#${id}`}
              className={`options__nav-link${activeSection === id ? ' is-current' : ''}`}
            >
              <span className="options__nav-link-rail" aria-hidden="true" />
              <span className="options__nav-link-text">{SECTION_LABELS[id]}</span>
            </a>
          ))}
        </nav>

        <div className="options__sections">
          <div className="options__hero">
            <p className="options__hero-eyebrow">Workspace</p>
            <h1>Settings</h1>
            <p className="options__lede">
              Bring your own keys. Captures route directly from your browser to your provider — never through us.
            </p>
          </div>

          {/* ─── LLM ─── */}
          <section className="options__section" id="sec-llm">
            <SectionHead
              title="Language model"
              hint="Writes example sentences and translates EN → PT-BR."
              status={llmTest && {
                ok: llmTest.ok,
                text: llmTest.ok ? 'Connected' : 'Failed',
                latencyMs: llmTest.latencyMs,
              }}
            />

            <div className="options__row">
              <div className="options__row-label">
                Provider
                <span className="options__row-help">Pick where requests are sent.</span>
              </div>
              <div className="options__row-input">
                <Select
                  ariaLabel="Language model provider"
                  value={settings.llm.provider}
                  onChange={(v) => void onLLMProviderChange(v as LLMProvider)}
                  options={LLM_PROVIDERS.map((p) => ({
                    value: p.value,
                    label: p.label,
                    hint: p.tag,
                  }))}
                />
              </div>
            </div>

            <div className="options__row">
              <div className="options__row-label">
                API key
                <span className="options__row-help">Stored locally. Never synced.</span>
              </div>
              <div className="options__row-input">
                <input
                  type="password"
                  className="options__input"
                  autoComplete="off"
                  spellCheck={false}
                  value={settings.llm.apiKey}
                  onChange={(e) => void update({ llm: { ...settings.llm, apiKey: e.target.value } })}
                  placeholder={`Paste your ${labelOf(settings.llm.provider)} key`}
                />
              </div>
            </div>

            <div className="options__row">
              <div className="options__row-label">
                Model
                <span className="options__row-help">Override the default if needed.</span>
              </div>
              <div className="options__row-input">
                <input
                  type="text"
                  className="options__input"
                  value={settings.llm.model}
                  onChange={(e) => void update({ llm: { ...settings.llm, model: e.target.value } })}
                />
              </div>
            </div>

            <div className="options__actions">
              <button
                type="button"
                className="options__btn"
                onClick={() => void onTestLLM()}
                disabled={llmTesting || !settings.llm.apiKey.trim()}
              >
                {llmTesting ? 'Testing…' : 'Test connection'}
              </button>
              {llmTest && !llmTest.ok && (
                <span className="options__inline-status is-err">{llmTest.message}</span>
              )}
            </div>
          </section>

          {/* ─── TTS ─── */}
          <section className="options__section" id="sec-tts">
            <SectionHead
              title="Voice"
              hint="Generates the pronunciation embedded in every Anki card."
              status={ttsTest && {
                ok: ttsTest.ok,
                text: ttsTest.ok ? 'Connected' : 'Failed',
                latencyMs: ttsTest.latencyMs,
              }}
            />

            <div className="options__row">
              <div className="options__row-label">
                Provider
                <span className="options__row-help">Free options work without a key.</span>
              </div>
              <div className="options__row-input">
                <Select
                  ariaLabel="Audio processor"
                  value={settings.tts.provider}
                  onChange={(v) => void onTTSProviderChange(v as TTSProvider)}
                  options={TTS_PROVIDERS.map((p) => ({
                    value: p.value,
                    label: p.label,
                    hint: p.tag,
                  }))}
                />
              </div>
            </div>

            {settings.tts.provider === 'edge' && (
              <div className="options__row">
                <div className="options__row-label">Voice</div>
                <div className="options__row-input">
                  <Select
                    ariaLabel="Edge voice"
                    value={settings.tts.voiceId}
                    onChange={(v) =>
                      void update({ tts: { ...settings.tts, voiceId: v } })
                    }
                    options={EDGE_VOICES.map((v) => ({ value: v.id, label: v.label }))}
                  />
                </div>
              </div>
            )}

            {settings.tts.provider === 'elevenlabs' && (
              <>
                <div className="options__row">
                  <div className="options__row-label">
                    API key
                    <span className="options__row-help">Stored locally.</span>
                  </div>
                  <div className="options__row-input">
                    <input
                      type="password"
                      className="options__input"
                      autoComplete="off"
                      spellCheck={false}
                      value={settings.tts.apiKey ?? ''}
                      onChange={(e) =>
                        void update({ tts: { ...settings.tts, apiKey: e.target.value } })
                      }
                    />
                  </div>
                </div>
                <div className="options__row">
                  <div className="options__row-label">
                    Voice ID
                    <span className="options__row-help">Find one in ElevenLabs › Voices.</span>
                  </div>
                  <div className="options__row-input">
                    <input
                      type="text"
                      className="options__input"
                      value={settings.tts.voiceId}
                      onChange={(e) =>
                        void update({ tts: { ...settings.tts, voiceId: e.target.value } })
                      }
                    />
                  </div>
                </div>
              </>
            )}

            <SwitchRow
              checked={settings.tts.generateTermAudio}
              onChange={(v) =>
                void update({ tts: { ...settings.tts, generateTermAudio: v } })
              }
              title="Term audio"
              help="Also generate audio for the term alone. Doubles TTS cost."
            />

            <div className="options__actions">
              <button
                type="button"
                className="options__btn"
                onClick={() => void onTestTTS()}
                disabled={
                  ttsTesting ||
                  (settings.tts.provider === 'elevenlabs' && !(settings.tts.apiKey ?? '').trim())
                }
              >
                {ttsTesting ? 'Testing…' : 'Test connection'}
              </button>
              <button
                type="button"
                className="options__btn"
                onClick={() => void onPreviewVoice()}
                disabled={previewing}
              >
                {previewing ? 'Generating…' : 'Preview voice'}
              </button>
              {ttsTest && !ttsTest.ok && (
                <span className="options__inline-status is-err">{ttsTest.message}</span>
              )}
              {previewMsg && (
                <span
                  className={`options__inline-status ${previewMsg.kind === 'ok' ? 'is-ok' : 'is-err'}`}
                >
                  {previewMsg.text}
                </span>
              )}
            </div>
          </section>

          {/* ─── Anki ─── */}
          <section className="options__section" id="sec-anki">
            <SectionHead
              title="Anki export"
              hint={<>Where your cards land. Note type is locked to <code>Hermes Card</code>.</>}
            />

            <div className="options__row">
              <div className="options__row-label">
                Deck name
                <span className="options__row-help">Use <code>::</code> for nested decks.</span>
              </div>
              <div className="options__row-input">
                <input
                  type="text"
                  className="options__input"
                  value={settings.anki.deckName}
                  onChange={(e) =>
                    void update({ anki: { ...settings.anki, deckName: e.target.value } })
                  }
                />
              </div>
            </div>
            <div className="options__row">
              <div className="options__row-label">
                Default tags
                <span className="options__row-help">Comma-separated.</span>
              </div>
              <div className="options__row-input">
                <input
                  type="text"
                  className="options__input"
                  value={settings.anki.defaultTags.join(', ')}
                  onChange={(e) =>
                    void update({
                      anki: {
                        ...settings.anki,
                        defaultTags: e.target.value
                          .split(',')
                          .map((t) => t.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                  placeholder="news, vocab, …"
                />
              </div>
            </div>
          </section>

          {/* ─── Capture ─── */}
          <section className="options__section" id="sec-capture">
            <SectionHead
              title="Capture"
              hint="Pick how you start a capture. All work side-by-side."
            />

            <SwitchRow
              checked={settings.triggers.contextMenu}
              onChange={(v) =>
                void update({ triggers: { ...settings.triggers, contextMenu: v } })
              }
              title="Right-click menu"
              help="Right-click any selected text → Add '…' to Hermes."
            />
            <SwitchRow
              checked={settings.triggers.floatingButton}
              onChange={(v) =>
                void update({ triggers: { ...settings.triggers, floatingButton: v } })
              }
              title="Floating action button"
              help="Show an Add button next to text you select on the page."
            />
            <SwitchRow
              checked={settings.triggers.hotkey}
              onChange={(v) =>
                void update({ triggers: { ...settings.triggers, hotkey: v } })
              }
              title="Keyboard shortcut"
              help={
                <>
                  Default <code>Ctrl/⌘ + Shift + H</code>. Re-bind in{' '}
                  <code>chrome://extensions/shortcuts</code>.
                </>
              }
            />
            <SwitchRow
              checked={settings.triggers.rememberLastMode}
              onChange={(v) =>
                void update({ triggers: { ...settings.triggers, rememberLastMode: v } })
              }
              title="Remember last mode"
              help="Skip the Generate / Verbatim picker on subsequent captures."
            />
          </section>

          {/* ─── Usage ─── */}
          <section className="options__section" id="sec-usage">
            <SectionHead
              title="Usage"
              hint={<>Approximate API spend. Token counts use a <code>chars ÷ 4</code> heuristic.</>}
              right={
                <Select
                  ariaLabel="Usage month"
                  width={150}
                  value={selectedMonth}
                  onChange={setSelectedMonth}
                  options={monthOptions}
                />
              }
            />

            {usage ? (
              <div className="options__quota">
                <QuotaCard label="LLM calls" value={usage.llmCalls.toString()} />
                <QuotaCard label="TTS calls" value={usage.ttsCalls.toString()} />
                <QuotaCard
                  label="Tokens · in / out"
                  value={`${formatNum(usage.inputTokens)} / ${formatNum(usage.outputTokens)}`}
                />
                <QuotaCard
                  label="Estimated spend"
                  value={`$${usage.estCostUSD.toFixed(3)}`}
                  sub={selectedMonth}
                />
              </div>
            ) : (
              <p className="options__hint">No usage recorded for this month yet.</p>
            )}
          </section>

          {/* ─── Backup ─── */}
          <section className="options__section" id="sec-backup">
            <SectionHead
              title="Backup &amp; restore"
              hint="JSON is full-fidelity (highlights, source metadata). CSV is for inspection."
            />
            <div className="options__actions" style={{ marginTop: 0 }}>
              <button
                type="button"
                className="options__btn"
                onClick={() => void downloadBlob(exportJSON(), 'hermes-backup.json')}
              >
                Export JSON
              </button>
              <button
                type="button"
                className="options__btn"
                onClick={() => void downloadBlob(exportCSV(), 'hermes-cards.csv')}
              >
                Export CSV
              </button>
              <button
                type="button"
                className="options__btn"
                onClick={() => fileRef.current?.click()}
              >
                Import JSON
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const { added, skipped } = await importJSON(await f.text());
                    setImportStatus({
                      kind: 'ok',
                      text: `Imported ${added}, skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}.`,
                    });
                  } catch (err) {
                    setImportStatus({
                      kind: 'err',
                      text: err instanceof Error ? err.message : String(err),
                    });
                  } finally {
                    e.target.value = '';
                  }
                }}
              />
              {importStatus && (
                <span
                  className={`options__inline-status ${importStatus.kind === 'ok' ? 'is-ok' : 'is-err'}`}
                >
                  {importStatus.text}
                </span>
              )}
            </div>
          </section>

          {/* ─── Developer ─── */}
          <section className="options__section" id="sec-debug">
            <SectionHead
              title="Developer"
              hint="For troubleshooting only."
            />

            <SwitchRow
              checked={settings.debug.agentTraceVisible}
              onChange={(v) =>
                void update({ debug: { ...settings.debug, agentTraceVisible: v } })
              }
              title="Agent trace"
              help="Surfaces each pipeline step in the popover as it runs."
            />
            <SwitchRow
              checked={settings.debug.langsmith.enabled}
              onChange={(v) =>
                void update({
                  debug: {
                    ...settings.debug,
                    langsmith: { ...settings.debug.langsmith, enabled: v },
                  },
                })
              }
              title="LangSmith tracing"
              help="Optional. Requires a LangSmith API key."
            />
            {settings.debug.langsmith.enabled && (
              <>
                <div className="options__row">
                  <div className="options__row-label">LangSmith API key</div>
                  <div className="options__row-input">
                    <input
                      type="password"
                      className="options__input"
                      autoComplete="off"
                      value={settings.debug.langsmith.apiKey ?? ''}
                      onChange={(e) =>
                        void update({
                          debug: {
                            ...settings.debug,
                            langsmith: { ...settings.debug.langsmith, apiKey: e.target.value },
                          },
                        })
                      }
                    />
                  </div>
                </div>
                <div className="options__row">
                  <div className="options__row-label">Project</div>
                  <div className="options__row-input">
                    <input
                      type="text"
                      className="options__input"
                      value={settings.debug.langsmith.project ?? 'hermes'}
                      onChange={(e) =>
                        void update({
                          debug: {
                            ...settings.debug,
                            langsmith: { ...settings.debug.langsmith, project: e.target.value },
                          },
                        })
                      }
                    />
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </main>

      {savedAt && <div key={savedAt} className="options__saved" aria-live="polite">Saved</div>}
    </>
  );
}

function SectionHead({
  icon,
  title,
  hint,
  status,
  right,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  hint?: React.ReactNode;
  status?: { ok: boolean; text: string; latencyMs?: number } | null;
  right?: React.ReactNode;
}) {
  return (
    <div className="options__section-head">
      <div className="options__section-title">
        {icon && <span className="options__section-icon" aria-hidden="true">{icon}</span>}
        <div>
          <h2>{title}</h2>
          {hint && <p className="options__section-hint">{hint}</p>}
        </div>
      </div>
      {status && (
        <span
          className={`options__inline-status ${status.ok ? 'is-ok' : 'is-err'}`}
          role="status"
        >
          <span className="options__indicator" aria-hidden="true" />
          {status.text}
          {status.latencyMs ? ` · ${status.latencyMs} ms` : ''}
        </span>
      )}
      {right}
    </div>
  );
}

function SwitchRow({
  checked,
  onChange,
  title,
  help,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  help?: React.ReactNode;
}) {
  return (
    <div className="options__row options__row--check">
      <div className="options__row-label">
        {title}
        {help && <span className="options__row-help">{help}</span>}
      </div>
      <div className="options__check-row">
        <label className="options__switch">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="options__switch-track" />
        </label>
      </div>
    </div>
  );
}

function QuotaCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="options__quota-card">
      <div className="options__quota-label">{label}</div>
      <div className="options__quota-value">{value}</div>
      {sub && <div className="options__quota-sub">{sub}</div>}
    </div>
  );
}

function formatNum(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function labelOf(p: LLMProvider): string {
  return LLM_PROVIDERS.find((x) => x.value === p)?.label ?? p;
}

async function downloadBlob(p: Promise<Blob>, filename: string): Promise<void> {
  const blob = await p;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function BrandIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 18 19"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3.65786 18.9999H0.0349086H0L4.6864 10.725H16.4108L13.3178 16.1864H9.66796L11.6176 12.7438H7.20091L3.65786 18.9999Z" />
      <path d="M14.3421 -5.72205e-05H17.9651H18L13.3136 8.2749H1.58924L4.68223 2.8135H8.33204L6.38241 6.25605H10.7991L14.3421 -5.72205e-05Z" />
    </svg>
  );
}

