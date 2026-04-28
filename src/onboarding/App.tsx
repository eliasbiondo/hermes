import { useEffect, useState } from 'react';
import { loadSettings, saveSettings } from '@/lib/storage/settings-store';
import {
  ensureLLMPermission,
  ensureTTSPermission,
} from '@/lib/providers/host-permissions';
import { testLLM, testTTS, type TestResult } from '@/lib/providers/test-connection';
import { hasRequiredKeys, type LLMProvider, type Settings, type TTSProvider } from '@/types/settings';

type Step = 'welcome' | 'llm' | 'tts' | 'try' | 'done';

const STEPS: Step[] = ['welcome', 'llm', 'tts', 'try', 'done'];

const STEP_LABEL: Record<Step, string> = {
  welcome: 'Welcome',
  llm:     'Language model',
  tts:     'Voice',
  try:     'Try it',
  done:    'Ready',
};

interface LLMOption {
  value: LLMProvider;
  label: string;
  tag: string;
  defaultModel: string;
}

const LLM_OPTIONS: LLMOption[] = [
  { value: 'gemini',     label: 'Gemini',     tag: 'recommended',  defaultModel: 'gemini-2.5-flash' },
  { value: 'openai',     label: 'OpenAI',     tag: 'GPT family',   defaultModel: 'gpt-4o' },
  { value: 'anthropic',  label: 'Anthropic',  tag: 'Claude family',defaultModel: 'claude-sonnet-4-6' },
  { value: 'openrouter', label: 'OpenRouter', tag: 'multi-model',  defaultModel: 'openai/gpt-4o' },
];

interface TTSOption {
  value: TTSProvider;
  label: string;
  tag: string;
}

const TTS_OPTIONS: TTSOption[] = [
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

const KEY_HELP_URL: Record<LLMProvider, string> = {
  gemini:     'https://aistudio.google.com/app/apikey',
  openai:     'https://platform.openai.com/api-keys',
  anthropic:  'https://console.anthropic.com/settings/keys',
  openrouter: 'https://openrouter.ai/keys',
};

export default function App() {
  const [step, setStep] = useState<Step>('welcome');
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => { void loadSettings().then(setSettings); }, []);

  if (!settings) {
    return (
      <main className="ob">
        <div className="ob__loading">Loading…</div>
      </main>
    );
  }

  const update = async (patch: Partial<Settings>): Promise<Settings> => {
    const next = await saveSettings(patch);
    setSettings(next);
    return next;
  };

  const idx = STEPS.indexOf(step);

  return (
    <main className="ob">
      <div className="ob__shell">
        <div className="ob__brand">
          <BrandIcon />
          <span className="ob__brand-name">Hermes</span>
        </div>

        <ol className="ob__stepper" aria-label="Setup progress">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className={
                i < idx ? 'is-complete' : i === idx ? 'is-active' : ''
              }
            />
          ))}
        </ol>
        <div className="ob__step-label">
          <span>Step <strong>{idx + 1}</strong> of {STEPS.length}</span>
          <span><strong>{STEP_LABEL[step]}</strong></span>
        </div>

        <div className="ob__card">
          {step === 'welcome' && <Welcome onNext={() => setStep('llm')} />}
          {step === 'llm' && (
            <LLMStep
              settings={settings}
              update={update}
              onBack={() => setStep('welcome')}
              onNext={() => setStep('tts')}
            />
          )}
          {step === 'tts' && (
            <TTSStep
              settings={settings}
              update={update}
              onBack={() => setStep('llm')}
              onNext={() => setStep('try')}
            />
          )}
          {step === 'try' && (
            <TryStep
              onNext={() => setStep('done')}
              onBack={() => setStep('tts')}
            />
          )}
          {step === 'done' && <DoneStep settings={settings} />}
        </div>
      </div>
    </main>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <section>
      <h1>Build your English vocabulary, in flow.</h1>
      <p className="lede">
        Hermes turns any English text you select into Anki-ready flashcards
        (EN → PT-BR), with AI-written context and pronunciation audio. Bring
        your own keys — nothing routes through us.
      </p>

      <div className="ob__features">
        <div className="ob__feature">
          <div className="ob__feature-icon">
            <SelectIcon />
          </div>
          <div className="ob__feature-title">Two clicks to capture</div>
          <div className="ob__feature-text">Select text, choose a mode, save.</div>
        </div>
        <div className="ob__feature">
          <div className="ob__feature-icon">
            <SparkIcon />
          </div>
          <div className="ob__feature-title">AI-enriched cards</div>
          <div className="ob__feature-text">Sentence, translation, and audio every time.</div>
        </div>
        <div className="ob__feature">
          <div className="ob__feature-icon">
            <ExportIcon />
          </div>
          <div className="ob__feature-title">Native Anki export</div>
          <div className="ob__feature-text">Ready-to-import .apkg, offline-ready.</div>
        </div>
      </div>

      <div className="ob__actions">
        <span className="ob__actions-spacer" />
        <button type="button" className="ob__btn ob__btn--primary" onClick={onNext} autoFocus>
          Get started
          <ArrowRightIcon />
        </button>
      </div>
    </section>
  );
}

function LLMStep({
  settings,
  update,
  onBack,
  onNext,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<Settings>;
  onBack: () => void;
  onNext: () => void;
}) {
  const [test, setTest] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);

  const onProvider = async (provider: LLMProvider) => {
    const def = LLM_OPTIONS.find((p) => p.value === provider)!;
    await ensureLLMPermission(provider);
    await update({ llm: { ...settings.llm, provider, model: def.defaultModel } });
    setTest(null);
  };

  const onTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      const granted = await ensureLLMPermission(settings.llm.provider);
      if (!granted) {
        setTest({ ok: false, latencyMs: 0, message: 'Host permission denied.' });
        return;
      }
      setTest(await testLLM(settings.llm));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h1>Pick a language model</h1>
      <p className="lede">
        This writes English example sentences and translates them to Portuguese.
      </p>

      <div className="ob__providers">
        {LLM_OPTIONS.map((p) => (
          <label
            key={p.value}
            className={`ob__provider${settings.llm.provider === p.value ? ' is-active' : ''}`}
          >
            <input
              type="radio"
              name="llm-provider"
              checked={settings.llm.provider === p.value}
              onChange={() => void onProvider(p.value)}
            />
            <span className="ob__provider-name">{p.label}</span>
            <span className="ob__provider-tag">{p.tag}</span>
          </label>
        ))}
      </div>

      <div className="ob__field">
        <span className="ob__field-label">API key</span>
        <input
          type="password"
          className="ob__input"
          autoComplete="off"
          spellCheck={false}
          value={settings.llm.apiKey}
          onChange={(e) => void update({ llm: { ...settings.llm, apiKey: e.target.value } })}
          placeholder={`Paste your ${labelOf(settings.llm.provider)} key`}
        />
        <span className="ob__field-help">
          Stored locally — never synced.
          {' '}
          <a href={KEY_HELP_URL[settings.llm.provider]} target="_blank" rel="noreferrer">
            Get a {labelOf(settings.llm.provider)} key
          </a>
          .
        </span>
      </div>

      <div className="ob__field">
        <span className="ob__field-label">Model</span>
        <input
          type="text"
          className="ob__input"
          value={settings.llm.model}
          onChange={(e) => void update({ llm: { ...settings.llm, model: e.target.value } })}
        />
      </div>

      {test && (
        <div className={`ob__test ${test.ok ? 'is-ok' : 'is-err'}`}>
          <span className="ob__test-dot" aria-hidden="true" />
          <span>
            {test.ok ? 'Connected' : test.message}
            {test.latencyMs ? ` · ${test.latencyMs} ms` : ''}
          </span>
        </div>
      )}

      <div className="ob__actions">
        <button type="button" className="ob__btn ob__btn--ghost" onClick={onBack}>
          <ArrowLeftIcon /> Back
        </button>
        <span className="ob__actions-spacer" />
        <button
          type="button"
          className="ob__btn"
          onClick={() => void onTest()}
          disabled={busy || !settings.llm.apiKey.trim()}
        >
          {busy ? 'Testing…' : 'Test connection'}
        </button>
        <button
          type="button"
          className="ob__btn ob__btn--primary"
          onClick={onNext}
          disabled={!test?.ok}
        >
          Next <ArrowRightIcon />
        </button>
      </div>
    </section>
  );
}

function TTSStep({
  settings,
  update,
  onBack,
  onNext,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<Settings>;
  onBack: () => void;
  onNext: () => void;
}) {
  const [test, setTest] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);

  const onProvider = async (provider: TTSProvider) => {
    if (provider !== 'browser') await ensureTTSPermission(provider);
    const voiceId =
      provider === 'edge' ? 'en-US-JennyNeural' :
      provider === 'elevenlabs' ? 'BIvP0GN1cAtSRTxNHnWS' :
      settings.tts.voiceId;
    await update({ tts: { ...settings.tts, provider, voiceId } });
    setTest(null);
  };

  const onTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      const granted = await ensureTTSPermission(settings.tts.provider);
      if (!granted) {
        setTest({ ok: false, latencyMs: 0, message: 'Host permission denied.' });
        return;
      }
      setTest(await testTTS(settings.tts));
    } finally {
      setBusy(false);
    }
  };

  const ready =
    settings.tts.provider === 'browser' ||
    settings.tts.provider === 'edge' ||
    (settings.tts.apiKey ?? '').trim().length > 0;

  // Browser TTS doesn't need a real test — let users continue.
  const canContinue = test?.ok || (settings.tts.provider === 'browser' && ready);

  return (
    <section>
      <h1>Pick a voice</h1>
      <p className="lede">
        Generates the pronunciation audio embedded in every Anki card.
      </p>

      <div className="ob__providers">
        {TTS_OPTIONS.map((p) => (
          <label
            key={p.value}
            className={`ob__provider${settings.tts.provider === p.value ? ' is-active' : ''}`}
          >
            <input
              type="radio"
              name="tts-provider"
              checked={settings.tts.provider === p.value}
              onChange={() => void onProvider(p.value)}
            />
            <span className="ob__provider-name">{p.label}</span>
            <span className="ob__provider-tag">{p.tag}</span>
          </label>
        ))}
      </div>

      {settings.tts.provider === 'edge' && (
        <div className="ob__field">
          <span className="ob__field-label">Voice</span>
          <select
            className="ob__select"
            value={settings.tts.voiceId}
            onChange={(e) => void update({ tts: { ...settings.tts, voiceId: e.target.value } })}
          >
            {EDGE_VOICES.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </div>
      )}

      {settings.tts.provider === 'elevenlabs' && (
        <>
          <div className="ob__field">
            <span className="ob__field-label">API key</span>
            <input
              type="password"
              className="ob__input"
              autoComplete="off"
              spellCheck={false}
              value={settings.tts.apiKey ?? ''}
              onChange={(e) => void update({ tts: { ...settings.tts, apiKey: e.target.value } })}
            />
            <span className="ob__field-help">
              <a href="https://elevenlabs.io/app/api-key" target="_blank" rel="noreferrer">
                Get an ElevenLabs key
              </a>
            </span>
          </div>
          <div className="ob__field">
            <span className="ob__field-label">Voice ID</span>
            <input
              type="text"
              className="ob__input"
              value={settings.tts.voiceId}
              onChange={(e) => void update({ tts: { ...settings.tts, voiceId: e.target.value } })}
            />
          </div>
        </>
      )}

      {test && (
        <div className={`ob__test ${test.ok ? 'is-ok' : 'is-err'}`}>
          <span className="ob__test-dot" aria-hidden="true" />
          <span>
            {test.ok ? 'Voice ready' : test.message}
            {test.latencyMs ? ` · ${test.latencyMs} ms` : ''}
          </span>
        </div>
      )}

      <div className="ob__actions">
        <button type="button" className="ob__btn ob__btn--ghost" onClick={onBack}>
          <ArrowLeftIcon /> Back
        </button>
        <span className="ob__actions-spacer" />
        <button
          type="button"
          className="ob__btn"
          onClick={() => void onTest()}
          disabled={busy || !ready}
        >
          {busy ? 'Testing…' : 'Test'}
        </button>
        <button
          type="button"
          className="ob__btn ob__btn--primary"
          onClick={onNext}
          disabled={!canContinue}
        >
          Next <ArrowRightIcon />
        </button>
      </div>
    </section>
  );
}

function TryStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <section>
      <h1>Capture your first card</h1>
      <p className="lede">
        Hermes works on any web page. Try it now or skip ahead — the steps stay the
        same.
      </p>

      <ol className="ob__list">
        <li>
          <span className="ob__list-num">1</span>
          <span className="ob__list-text">Open any English-language article in a new tab.</span>
        </li>
        <li>
          <span className="ob__list-num">2</span>
          <span className="ob__list-text">Select a word or phrase you want to remember.</span>
        </li>
        <li>
          <span className="ob__list-num">3</span>
          <span className="ob__list-text">
            Right-click <em>Add '…' to Hermes</em> or press{' '}
            <em>Ctrl/⌘ + Shift + H</em>.
          </span>
        </li>
        <li>
          <span className="ob__list-num">4</span>
          <span className="ob__list-text">
            Pick <em>Generate sentence</em> or <em>Use as-is</em>. Hermes does the rest.
          </span>
        </li>
      </ol>

      <div className="ob__actions">
        <button type="button" className="ob__btn ob__btn--ghost" onClick={onBack}>
          <ArrowLeftIcon /> Back
        </button>
        <span className="ob__actions-spacer" />
        <button
          type="button"
          className="ob__btn"
          onClick={() =>
            chrome.tabs.create({ url: 'https://en.wikipedia.org/wiki/Special:Random' })
          }
        >
          Open a sample page
        </button>
        <button type="button" className="ob__btn ob__btn--primary" onClick={onNext}>
          I'm ready <ArrowRightIcon />
        </button>
      </div>
    </section>
  );
}

function DoneStep({ settings }: { settings: Settings }) {
  const ready = hasRequiredKeys(settings);
  return (
    <section style={{ textAlign: 'center' }}>
      {ready ? (
        <>
          <div className="ob__success-mark" aria-hidden="true">
            <CheckIcon size={28} />
          </div>
          <h1>You're all set</h1>
          <p className="lede">
            Capture is enabled. Pin Hermes to your toolbar to access your card library
            and Anki export anytime.
          </p>
        </>
      ) : (
        <>
          <h1>Almost there</h1>
          <div className="ob__warn">
            Some keys are still missing. Open settings to finish.
          </div>
        </>
      )}

      <div className="ob__actions" style={{ justifyContent: 'center' }}>
        <button
          type="button"
          className="ob__btn"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          Open settings
        </button>
        <button
          type="button"
          className="ob__btn ob__btn--primary"
          onClick={() => window.close()}
        >
          Close
        </button>
      </div>
    </section>
  );
}

function labelOf(p: LLMProvider): string {
  return LLM_OPTIONS.find((x) => x.value === p)?.label ?? p;
}

/* Icons */

function BrandIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className="ob__brand-icon"
      aria-hidden="true"
    >
      <path d="M12 3 22 21H2L12 3Z" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19 12H5M11 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12 5 5L20 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SelectIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 4h6M4 4v6M20 20h-6M20 20v-6M4 14v6h6M14 4h6v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v12M6 10l6-6 6 6M4 20h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
