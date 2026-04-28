import { useEffect, useRef, useState } from 'react';
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

const LLM_PROVIDERS: { value: LLMProvider; label: string; defaultModel: string }[] = [
  { value: 'gemini', label: 'Gemini', defaultModel: 'gemini-2.5-flash' },
  { value: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o' },
  { value: 'anthropic', label: 'Anthropic', defaultModel: 'claude-sonnet-4-6' },
  { value: 'openrouter', label: 'OpenRouter', defaultModel: 'openai/gpt-4o' },
];

const TTS_PROVIDERS: { value: TTSProvider; label: string }[] = [
  { value: 'edge', label: 'Microsoft Edge Read Aloud (free, neural)' },
  { value: 'elevenlabs', label: 'ElevenLabs (paid)' },
  { value: 'browser', label: 'Browser SpeechSynthesis (free fallback)' },
];

const EDGE_VOICES = [
  { id: 'en-US-AriaNeural', label: 'Aria (US, female)' },
  { id: 'en-US-JennyNeural', label: 'Jenny (US, female)' },
  { id: 'en-US-GuyNeural', label: 'Guy (US, male)' },
  { id: 'en-US-AndrewNeural', label: 'Andrew (US, male)' },
  { id: 'en-US-EmmaNeural', label: 'Emma (US, female)' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia (UK, female)' },
  { id: 'en-GB-RyanNeural', label: 'Ryan (UK, male)' },
];

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [llmTest, setLlmTest] = useState<TestResult | null>(null);
  const [ttsTest, setTtsTest] = useState<TestResult | null>(null);
  const [llmTesting, setLlmTesting] = useState(false);
  const [ttsTesting, setTtsTesting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewMsg, setPreviewMsg] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonth());
  const [usage, setUsage] = useState<MonthlySummary | null>(null);

  useEffect(() => {
    void listMonths().then(setMonths);
  }, []);
  useEffect(() => {
    void summarizeMonth(selectedMonth).then(setUsage);
  }, [selectedMonth, savedAt]);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  if (!settings) return <main className="options"><p>Loading…</p></main>;

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
    // Reset voice ID to a sensible default for the new provider so the user
    // doesn't end up with an ElevenLabs voice ID selected for Edge etc.
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
      setPreviewMsg(`Played ${(blob.size / 1024).toFixed(1)} KB.`);
    } catch (e) {
      setPreviewMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  };

  const ready = hasRequiredKeys(settings);

  return (
    <main className="options">
      <h1>Hermes Settings</h1>
      <p className="options__lede">
        Bring-your-own-keys: nothing routes through a third-party server.
      </p>

      <div className={`options__status ${ready ? 'is-ready' : 'is-blocked'}`} role="status">
        {ready
          ? 'Capture is enabled.'
          : 'Capture is disabled until at least one LLM key and one TTS option are configured.'}
      </div>

      <section className="options__section">
        <h2>LLM provider</h2>
        <label className="options__row">
          <span>Provider</span>
          <select
            value={settings.llm.provider}
            onChange={(e) => void onLLMProviderChange(e.target.value as LLMProvider)}
          >
            {LLM_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="options__row">
          <span>Model</span>
          <input
            type="text"
            value={settings.llm.model}
            onChange={(e) => void update({ llm: { ...settings.llm, model: e.target.value } })}
          />
        </label>
        <label className="options__row">
          <span>API key</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={settings.llm.apiKey}
            onChange={(e) => void update({ llm: { ...settings.llm, apiKey: e.target.value } })}
            placeholder="paste key — stored locally only"
          />
        </label>
        <div className="options__row options__row--actions">
          <button type="button" onClick={() => void onTestLLM()} disabled={llmTesting}>
            {llmTesting ? 'Testing…' : 'Test connection'}
          </button>
          {llmTest && (
            <span className={llmTest.ok ? 'is-ok' : 'is-err'}>
              {llmTest.message}
              {llmTest.latencyMs ? ` (${llmTest.latencyMs} ms)` : ''}
            </span>
          )}
        </div>
      </section>

      <section className="options__section">
        <h2>TTS provider</h2>
        <label className="options__row">
          <span>Provider</span>
          <select
            value={settings.tts.provider}
            onChange={(e) => void onTTSProviderChange(e.target.value as TTSProvider)}
          >
            {TTS_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
        {settings.tts.provider === 'edge' && (
          <label className="options__row">
            <span>Voice</span>
            <select
              value={settings.tts.voiceId}
              onChange={(e) => void update({ tts: { ...settings.tts, voiceId: e.target.value } })}
            >
              {EDGE_VOICES.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </label>
        )}
        {settings.tts.provider === 'elevenlabs' && (
          <>
            <label className="options__row">
              <span>API key</span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={settings.tts.apiKey ?? ''}
                onChange={(e) => void update({ tts: { ...settings.tts, apiKey: e.target.value } })}
              />
            </label>
            <label className="options__row">
              <span>Voice ID</span>
              <input
                type="text"
                value={settings.tts.voiceId}
                onChange={(e) => void update({ tts: { ...settings.tts, voiceId: e.target.value } })}
              />
            </label>
          </>
        )}
        <label className="options__row options__row--check">
          <input
            type="checkbox"
            checked={settings.tts.generateTermAudio}
            onChange={(e) =>
              void update({ tts: { ...settings.tts, generateTermAudio: e.target.checked } })
            }
          />
          <span>Generate term-only audio in addition to the sentence audio (F-3.2)</span>
        </label>
        <div className="options__row options__row--actions">
          <button type="button" onClick={() => void onTestTTS()} disabled={ttsTesting}>
            {ttsTesting ? 'Testing…' : 'Test connection'}
          </button>
          <button type="button" onClick={() => void onPreviewVoice()} disabled={previewing}>
            {previewing ? 'Generating…' : '▶︎ Preview voice'}
          </button>
          {ttsTest && (
            <span className={ttsTest.ok ? 'is-ok' : 'is-err'}>
              {ttsTest.message}
              {ttsTest.latencyMs ? ` (${ttsTest.latencyMs} ms)` : ''}
            </span>
          )}
          {previewMsg && (
            <span className={previewMsg.startsWith('Played') ? 'is-ok' : 'is-err'}>
              {previewMsg}
            </span>
          )}
        </div>
      </section>

      <section className="options__section">
        <h2>Anki export</h2>
        <label className="options__row">
          <span>Deck name</span>
          <input
            type="text"
            value={settings.anki.deckName}
            onChange={(e) => void update({ anki: { ...settings.anki, deckName: e.target.value } })}
          />
        </label>
        <label className="options__row">
          <span>Default tags</span>
          <input
            type="text"
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
        </label>
        <p className="options__hint">
          Note type locked to <code>Hermes Card</code> in v1.
        </p>
      </section>

      <section className="options__section">
        <h2>Debug</h2>
        <label className="options__row options__row--check">
          <input
            type="checkbox"
            checked={settings.debug.agentTraceVisible}
            onChange={(e) =>
              void update({
                debug: { ...settings.debug, agentTraceVisible: e.target.checked },
              })
            }
          />
          <span>Show the agent execution trace in the popover (F-5.6)</span>
        </label>
        <label className="options__row options__row--check">
          <input
            type="checkbox"
            checked={settings.debug.langsmith.enabled}
            onChange={(e) =>
              void update({
                debug: {
                  ...settings.debug,
                  langsmith: { ...settings.debug.langsmith, enabled: e.target.checked },
                },
              })
            }
          />
          <span>Send traces to LangSmith</span>
        </label>
        {settings.debug.langsmith.enabled && (
          <>
            <label className="options__row">
              <span>LangSmith API key</span>
              <input
                type="password"
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
            </label>
            <label className="options__row">
              <span>Project</span>
              <input
                type="text"
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
            </label>
          </>
        )}
      </section>

      <section className="options__section">
        <h2>Capture triggers</h2>
        {(['contextMenu', 'floatingButton', 'hotkey'] as const).map((k) => (
          <label key={k} className="options__row options__row--check">
            <input
              type="checkbox"
              checked={settings.triggers[k]}
              onChange={(e) =>
                void update({ triggers: { ...settings.triggers, [k]: e.target.checked } })
              }
            />
            <span>{labelForTrigger(k)}</span>
          </label>
        ))}
        <label className="options__row options__row--check">
          <input
            type="checkbox"
            checked={settings.triggers.rememberLastMode}
            onChange={(e) =>
              void update({
                triggers: { ...settings.triggers, rememberLastMode: e.target.checked },
              })
            }
          />
          <span>Remember my last mode choice (skip the picker on next capture)</span>
        </label>
      </section>

      <section className="options__section">
        <h2>Usage this month</h2>
        <label className="options__row">
          <span>Month</span>
          <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        {usage && (
          <div className="options__quota">
            <div><strong>{usage.llmCalls}</strong> LLM calls</div>
            <div><strong>{usage.ttsCalls}</strong> TTS calls</div>
            <div><strong>{usage.inputTokens.toLocaleString()}</strong> input tokens (est.)</div>
            <div><strong>{usage.outputTokens.toLocaleString()}</strong> output tokens (est.)</div>
            <div><strong>${usage.estCostUSD.toFixed(3)}</strong> estimated spend</div>
          </div>
        )}
        <p className="options__hint">
          Token counts and pricing are approximations using <code>chars ÷ 4</code> and
          provider list prices. Treat as a hint, not an invoice.
        </p>
      </section>

      <section className="options__section">
        <h2>Backup &amp; restore</h2>
        <p className="options__hint">JSON is full-fidelity (highlights, source metadata). CSV is for inspection.</p>
        <div className="options__row options__row--actions">
          <button
            type="button"
            onClick={() => void downloadBlob(exportJSON(), 'hermes-backup.json')}
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => void downloadBlob(exportCSV(), 'hermes-cards.csv')}
          >
            Export CSV
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
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
                setImportStatus(`Imported ${added} card(s); skipped ${skipped} duplicate(s).`);
              } catch (err) {
                setImportStatus(err instanceof Error ? err.message : String(err));
              } finally {
                e.target.value = '';
              }
            }}
          />
          {importStatus && <span className="is-ok">{importStatus}</span>}
        </div>
      </section>

      {savedAt && <div className="options__saved" aria-live="polite">Saved.</div>}
    </main>
  );
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

function labelForTrigger(k: 'contextMenu' | 'floatingButton' | 'hotkey'): string {
  switch (k) {
    case 'contextMenu': return 'Right-click context menu';
    case 'floatingButton': return 'Floating action button on text selection';
    case 'hotkey': return 'Keyboard shortcut (Ctrl/Cmd+Shift+H)';
  }
}
