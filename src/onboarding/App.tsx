import { useEffect, useState } from 'react';
import { loadSettings, saveSettings } from '@/lib/storage/settings-store';
import {
  ensureLLMPermission,
  ensureTTSPermission,
} from '@/lib/providers/host-permissions';
import { testLLM, testTTS, type TestResult } from '@/lib/providers/test-connection';
import { hasRequiredKeys, type LLMProvider, type Settings, type TTSProvider } from '@/types/settings';

type Step = 'welcome' | 'llm' | 'tts' | 'try' | 'done';

export default function App() {
  const [step, setStep] = useState<Step>('welcome');
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  if (!settings) return <main className="ob"><p>Loading…</p></main>;

  const update = async (patch: Partial<Settings>): Promise<Settings> => {
    const next = await saveSettings(patch);
    setSettings(next);
    return next;
  };

  return (
    <main className="ob">
      <Stepper step={step} />
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
      {step === 'try' && <TryStep onNext={() => setStep('done')} onBack={() => setStep('tts')} />}
      {step === 'done' && <DoneStep settings={settings} />}
    </main>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: Step[] = ['welcome', 'llm', 'tts', 'try', 'done'];
  const idx = steps.indexOf(step);
  return (
    <ol className="ob__stepper" aria-label="Onboarding progress">
      {steps.map((s, i) => (
        <li key={s} className={i <= idx ? 'is-active' : ''} aria-current={s === step ? 'step' : undefined}>
          <span>{labelFor(s)}</span>
        </li>
      ))}
    </ol>
  );
}

function labelFor(s: Step): string {
  switch (s) {
    case 'welcome': return 'Welcome';
    case 'llm':     return 'LLM';
    case 'tts':     return 'TTS';
    case 'try':     return 'Try it';
    case 'done':    return 'Done';
  }
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <section className="ob__step">
      <h1>Welcome to Hermes</h1>
      <p>
        Hermes turns English text you select on any web page into Anki-ready
        flashcards (EN → PT-BR), with AI-generated context and pronunciation
        audio.
      </p>
      <p>
        You'll bring your own API keys for an LLM and a TTS provider. Nothing
        you do is sent through a third-party server.
      </p>
      <button type="button" className="is-primary" onClick={onNext} autoFocus>
        Let's set it up →
      </button>
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
    await ensureLLMPermission(provider);
    await update({
      llm: {
        ...settings.llm,
        provider,
        model: provider === 'gemini' ? 'gemini-2.5-flash'
             : provider === 'openai' ? 'gpt-4o'
             : provider === 'anthropic' ? 'claude-sonnet-4-6'
             : 'openai/gpt-4o',
      },
    });
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
    <section className="ob__step">
      <h1>Connect your LLM</h1>
      <p>This is what writes example sentences and translations.</p>
      <label className="ob__field">
        <span>Provider</span>
        <select value={settings.llm.provider} onChange={(e) => void onProvider(e.target.value as LLMProvider)}>
          <option value="gemini">Gemini (recommended)</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="openrouter">OpenRouter</option>
        </select>
      </label>
      <label className="ob__field">
        <span>API key</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={settings.llm.apiKey}
          onChange={(e) => void update({ llm: { ...settings.llm, apiKey: e.target.value } })}
        />
      </label>
      <label className="ob__field">
        <span>Model</span>
        <input
          type="text"
          value={settings.llm.model}
          onChange={(e) => void update({ llm: { ...settings.llm, model: e.target.value } })}
        />
      </label>
      <div className="ob__actions">
        <button type="button" onClick={onBack}>← Back</button>
        <button type="button" onClick={() => void onTest()} disabled={busy || !settings.llm.apiKey.trim()}>
          {busy ? 'Testing…' : 'Test connection'}
        </button>
        <button
          type="button"
          className="is-primary"
          onClick={onNext}
          disabled={!test?.ok}
        >
          Next →
        </button>
      </div>
      {test && (
        <p className={test.ok ? 'is-ok' : 'is-err'}>
          {test.message}{test.latencyMs ? ` (${test.latencyMs} ms)` : ''}
        </p>
      )}
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

  return (
    <section className="ob__step">
      <h1>Pick a TTS</h1>
      <p>This generates the pronunciation audio embedded in each card.</p>
      <label className="ob__field">
        <span>Provider</span>
        <select value={settings.tts.provider} onChange={(e) => void onProvider(e.target.value as TTSProvider)}>
          <option value="edge">Microsoft Edge Read Aloud (free, recommended)</option>
          <option value="elevenlabs">ElevenLabs (paid)</option>
          <option value="browser">Browser SpeechSynthesis (free fallback)</option>
        </select>
      </label>
      {settings.tts.provider === 'edge' && (
        <label className="ob__field">
          <span>Voice</span>
          <select
            value={settings.tts.voiceId}
            onChange={(e) => void update({ tts: { ...settings.tts, voiceId: e.target.value } })}
          >
            <option value="en-US-AriaNeural">Aria (US, female)</option>
            <option value="en-US-JennyNeural">Jenny (US, female)</option>
            <option value="en-US-GuyNeural">Guy (US, male)</option>
            <option value="en-US-AndrewNeural">Andrew (US, male)</option>
            <option value="en-US-EmmaNeural">Emma (US, female)</option>
            <option value="en-GB-SoniaNeural">Sonia (UK, female)</option>
            <option value="en-GB-RyanNeural">Ryan (UK, male)</option>
          </select>
        </label>
      )}
      {settings.tts.provider === 'elevenlabs' && (
        <>
          <label className="ob__field">
            <span>API key</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={settings.tts.apiKey ?? ''}
              onChange={(e) => void update({ tts: { ...settings.tts, apiKey: e.target.value } })}
            />
          </label>
          <label className="ob__field">
            <span>Voice ID</span>
            <input
              type="text"
              value={settings.tts.voiceId}
              onChange={(e) => void update({ tts: { ...settings.tts, voiceId: e.target.value } })}
            />
          </label>
        </>
      )}
      <div className="ob__actions">
        <button type="button" onClick={onBack}>← Back</button>
        <button type="button" onClick={() => void onTest()} disabled={busy || !ready}>
          {busy ? 'Testing…' : 'Test'}
        </button>
        <button
          type="button"
          className="is-primary"
          onClick={onNext}
          disabled={!test?.ok}
        >
          Next →
        </button>
      </div>
      {test && (
        <p className={test.ok ? 'is-ok' : 'is-err'}>
          {test.message}{test.latencyMs ? ` (${test.latencyMs} ms)` : ''}
        </p>
      )}
    </section>
  );
}

function TryStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <section className="ob__step">
      <h1>Capture your first card</h1>
      <ol className="ob__list">
        <li>Open any English-language article in a new tab.</li>
        <li>Select a word or phrase you want to remember.</li>
        <li>Right-click → <em>Add '…' to Hermes</em> (or hit Ctrl/Cmd + Shift + H).</li>
        <li>Pick a mode in the popover. Hermes does the rest.</li>
      </ol>
      <p className="ob__hint">
        When you're ready, click <em>Done</em>. You can re-open this guide from
        Settings any time.
      </p>
      <div className="ob__actions">
        <button type="button" onClick={onBack}>← Back</button>
        <button
          type="button"
          onClick={() => chrome.tabs.create({ url: 'https://en.wikipedia.org/wiki/Special:Random' })}
        >
          Open a sample page
        </button>
        <button type="button" className="is-primary" onClick={onNext}>
          Done →
        </button>
      </div>
    </section>
  );
}

function DoneStep({ settings }: { settings: Settings }) {
  const ready = hasRequiredKeys(settings);
  return (
    <section className="ob__step">
      <h1>You're set up</h1>
      {ready ? (
        <p>Capture is enabled. Pin Hermes to your toolbar to access the cards list.</p>
      ) : (
        <p className="is-err">
          Some keys are still missing. Open Settings to finish.
        </p>
      )}
      <div className="ob__actions">
        <button type="button" onClick={() => chrome.runtime.openOptionsPage()}>
          Open settings
        </button>
        <button
          type="button"
          className="is-primary"
          onClick={() => window.close()}
        >
          Close
        </button>
      </div>
    </section>
  );
}
