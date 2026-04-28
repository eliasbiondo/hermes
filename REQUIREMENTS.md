# Hermes — Browser Extension Requirements

A browser extension for capturing English words and phrasal verbs from any webpage and turning them into Anki-ready flashcards (EN → PT-BR), with AI-generated context (Gemini, orchestrated via the **Deep Agents SDK** with **structured output**) and pronunciation audio (ElevenLabs / other TTS).

---

## 1. Goals

- **Friction-free capture**: select English text on any page → save a flashcard in ≤ 2 clicks.
- **Anki-native output**: every card is shaped exactly to be imported into Anki (front/back format defined in §4.7).
- **Rich cards by default**: every captured term is auto-enriched with example sentence, translation, and audio without the user typing anything.
- **Bring-your-own-keys**: user supplies their own LLM and TTS API keys; nothing routes through a third-party server.
- **Deep Agents orchestration**: enrichment is one deep agent (JS/TS, `deepagents` on npm) that plans, calls tools (translate, classify, tts, validate), and returns a single Zod-validated `Card` object via structured output. No bespoke state graph — the agent harness handles planning, retries, and tool-use loops. Runs entirely in the extension's service worker; no backend service required.
- **Polished UX**: feels like a first-party browser feature, not a hobby tool.

## 2. Non-goals (v1)

- No built-in spaced-repetition review UI — Anki is the review surface.
- No multi-language support: source is **English**, target is **Brazilian Portuguese** only.
- No account system, no cloud sync server.
- No mobile support.
- No collaborative decks / sharing.

---

## 3. Target user & primary use case

A Brazilian Portuguese speaker learning English, reading English-language articles, docs, or social media, who wants to bank vocabulary as they encounter it and review it later in Anki.

**Two capture modes** (user chooses per capture):

- **Mode A — Term-only ("generate sentence")**: user selects just `come up with` → pipeline generates a fresh English sentence around the term and uses that as the card front.
- **Mode B — Full-sentence ("use as-is")**: user selects the entire sentence `"he came up with a great idea"` → a sub-selection step lets them highlight `come up with` within it → the **captured sentence is used verbatim** as the card front (no sentence generation), with the highlighted span marked as the term.

**Mode is always asked, never inferred.** When the user triggers capture, the popover's first screen is a mode picker — two large buttons:

- **`Generate a sentence for me`** (Mode A) — the captured selection is treated as the term; the pipeline writes a fresh English sentence around it.
- **`Use my selection as the sentence`** (Mode B) — the captured selection is the front sentence verbatim; user then highlights the term inside it.

No heuristic, no auto-pre-selection. The user explicitly chooses every time.

**Canonical flow (Mode A):**
1. User reads an article, sees `"he came up with a great idea"`.
2. Selects `come up with` (or any text — selection contents don't affect which mode is offered).
3. Right-click → **"Add to Hermes"** (or floating popover button, or hotkey).
4. Popover opens on the mode picker. User clicks **Generate a sentence for me**.
5. Pipeline runs `classify → generate_sentence → translate → validate_alignment` + TTS. Live preview renders.
6. User clicks **Save**. Card is stored. Popover dismisses.

**Canonical flow (Mode B):**
1. User selects the whole sentence `"he came up with a great idea"`.
2. Right-click → **"Add to Hermes"**.
3. Popover opens on the mode picker. User clicks **Use my selection as the sentence**.
4. Selected sentence is rendered token-by-token; user drags or click-toggles to highlight `come up with`.
5. Pipeline runs `classify → translate → validate_alignment` + TTS (no sentence generation).
6. User clicks **Save**. Card is stored. Popover dismisses.

**Optional**: a "remember my last choice" checkbox on the mode picker — if ticked, future captures skip the picker and jump straight to the last-used mode. Default: **off**.

Later, user opens the extension → **Export to Anki** → downloads a ready-to-import `.apkg` file.

Total interaction time per capture target: **< 5 seconds (Mode A)**, **< 8 seconds (Mode B, includes sub-selection)**.

---

## 4. Functional requirements

### 4.1 Text capture
- **F-1.1** Capture from text selection on any HTTP/HTTPS page.
- **F-1.2** Trigger options (all enabled by default, individually toggleable in settings):
  - Right-click context menu item: *"Add '{selection}' to Hermes"*.
  - Floating action button that appears near the selection (like Medium's highlight bar).
  - Configurable keyboard shortcut (default: `Ctrl/Cmd + Shift + H`).
- **F-1.3** Two capture modes, both first-class (see §3 for the user flows):
  - **Mode A — Generate sentence**: the captured selection is the term; the pipeline generates the front sentence.
  - **Mode B — Use selection as-is**: the captured selection is the front sentence verbatim; a sub-selection UI in the popover lets the user highlight the term inside it.
- **F-1.4** **Mode is always chosen explicitly via a popover prompt** — no heuristic, no auto-detection, no default mode based on selection shape. The popover's first screen is a two-button mode picker. An optional "remember my last choice" checkbox lets power users skip the picker on subsequent captures (default off).
- **F-1.5** **Sub-selection UI (Mode B only)**: the captured sentence is rendered token-by-token in the popover. User can:
  - Click-drag across tokens to highlight a contiguous span.
  - Click individual tokens to toggle them into/out of the highlight (supports discontiguous span warning — if user picks discontiguous tokens, popover warns and asks them to pick a contiguous range, since Anki highlight is one span).
  - Pre-fill: if the user already had a sub-range highlighted on the page before triggering capture and then expanded to a full sentence, the original sub-range is pre-highlighted.
- **F-1.6** Auto-capture surrounding sentence as raw context for Mode A (the sentence containing the selection, capped at ~300 chars). For Mode B, the user's selection IS the sentence; raw context is not needed.
- **F-1.7** Auto-capture page metadata: URL, page title, capture timestamp (stored for reference, not shown on the Anki card).
- **F-1.8** Classify the term span as `word` | `phrasal_verb` automatically (heuristic + the agent's `classify_term` tool); user can override before saving. Applies to both modes.

### 4.2 Card enrichment — Deep Agents SDK
The enrichment is implemented as a **single deep agent** (`createDeepAgent` from the `deepagents` npm package), configured with a Zod-typed structured-output schema and a small set of tools. The agent itself decides what to call and in what order, given the system prompt and the user's mode (A or B). No hand-written state graph.

**Tools exposed to the agent (v1):**
- **`classify_term`** — given a term + (optional) raw context, returns `{ type: 'word' | 'phrasal_verb', baseVerb?, particle? }`.
- **`generate_sentence`** — given a term and its classification, returns `{ sentence, termSpan: HighlightSpan }`. Used in Mode A. The system prompt forbids calling it in Mode B.
- **`translate_sentence`** — given an English sentence and the term span within it, returns `{ translation, translatedTermSpan: HighlightSpan }`.
- **`validate_alignment`** — given the EN sentence/term span and the PT-BR translation/translated span, returns `{ ok: boolean, reason?: string }`. Called after translation; if `ok === false`, the agent re-calls `translate_sentence` with corrective hints. Capped at 2 retries via system-prompt guidance + `write_todos` counter.
- **`translate_term`** — returns the PT-BR translation of the term in isolation (for the back-side `Term → TermTranslation` line).
- **`tts_synthesize`** — given text + voice, returns `{ blobId }` (writes the MP3 to the audio cache and returns the IndexedDB ref). Called for the front sentence (mandatory) and optionally for the term alone.

**Structured output**: the agent's final response is constrained to a Zod schema matching the `CardEnrichment` shape (sentence, sentenceHighlight, sentenceTranslation, sentenceTranslationHighlight, termTranslation, sentenceAudioBlobId, termAudioBlobId?, type, baseVerb?, particle?). Validation failure → harness re-invokes the agent up to 2 times with the validation error appended.

**Mode-aware behavior**: mode is passed in the agent's first user message — e.g. `{ mode: 'A', term: '…', rawContext: '…' }` or `{ mode: 'B', sentence: '…', termSpan: {…} }`. The system prompt explicitly instructs the agent: *"If `mode === 'B'`, do NOT call `generate_sentence` — use the provided sentence verbatim and the user's `termSpan`, then proceed to translation."*

**Pipeline requirements:**
- **F-2.1** Use **`deepagents`** (JS/TS, npm) with `langchain` + `@langchain/core` for LLM client and tool definitions. **Zod** for structured-output schema and tool input/output schemas. No LangGraph state graph defined by us — the deep-agent harness handles the loop.
- **F-2.2** Single agent definition file: system prompt + tools array + structured-output schema + chosen LLM model.
- **F-2.3** UI subscribes to the agent's tool-call event stream; each tool invocation surfaces a labeled "step" in the popover (`classify…`, `generate sentence…`, `translate…`, `validate…`, `synthesize audio…`) so loading states stay granular even though there's no explicit graph.
- **F-2.4** Tool-level retry: each tool wraps its provider call with exponential backoff. If overall structured output fails Zod validation, the harness retries the agent up to 2 times.
- **F-2.5** Cache by `(term, term_type, mode)` to skip duplicate agent runs when the same term is captured again.
- **F-2.6** Show loading skeleton while the agent runs; allow Save before completion (remaining work continues in background, card status = `partial` until done).
- **F-2.7** User can edit any generated field inline before saving (sentence, translation, highlighted spans).
- **F-2.8** "Regenerate" button on a saved card re-runs the agent. A "Regenerate translation only" button kicks off a constrained agent invocation that's only allowed to call `translate_sentence` + `validate_alignment` + (re-)`tts_synthesize`.

### 4.3 TTS audio
- **F-3.1** TTS for the **front sentence** is mandatory and is the audio embedded in Anki (used for autoplay on card front).
- **F-3.2** TTS for the term alone is optional (toggle in settings); if enabled, also embedded in Anki for the back.
- **F-3.3** Audio is generated by the agent calling `tts_synthesize` during enrichment, so it's always ready by save time. No lazy generation in v1 — Anki export must always have complete audio.
- **F-3.4** Cache audio blobs locally (IndexedDB), keyed by `(text, voice_id, provider)`.
- **F-3.5** Playback controls (preview) in the popover and in the card list view.
- **F-3.6** Audio format: MP3 (Anki-compatible across desktop/mobile/web).

### 4.4 Card storage & management
- **F-4.1** Local-first storage in IndexedDB. No remote storage in v1.
- **F-4.2** Cards list view (extension popup or full-tab page) with:
  - Search by term
  - Filter by tag, source domain, date range, type (word / phrasal_verb), export status (exported / not yet exported)
  - Sort by date, alphabetical
- **F-4.3** Tags (free-form, user-defined). Suggested tags inferred from page domain ("nytimes.com" → "news").
- **F-4.4** Bulk select → delete / export / re-tag.
- **F-4.5** Per-card edit view with all fields editable, including highlight spans (drag-to-select on the rendered sentence).
- **F-4.6** Duplicate detection: if user captures a term already in the deck, popover shows the existing card with options to (a) cancel, (b) replace, (c) save as variant. **Default action: save as variant** (variants are linked via a shared `termGroupId`).

### 4.5 Settings
- **F-5.1** API keys (stored in `chrome.storage.local`, never synced):
  - LLM provider: dropdown (Gemini default, OpenAI, Anthropic, OpenRouter — all wired through LangChain) + API key field + model selector. **Default model: `gemini-2.5-pro`**.
  - TTS provider: dropdown (ElevenLabs default, OpenAI TTS, Google Cloud TTS, browser-native `SpeechSynthesis` as free fallback) + API key + voice selector. **A recommended ElevenLabs voice ID is shipped baked-in as the default** (a clear, neutral en-US voice — exact ID set during the build); user can preview / test other voices and switch via the voice selector.
- **F-5.2** Anki settings: deck name (default `Hermes::English`), note type name **locked to `Hermes Card`** (not user-configurable in v1 — keeps export/update logic simple and avoids GUID collisions across decks), default tags appended on export.
- **F-5.3** Behavior toggles: which capture triggers are active, hotkey binding, generate term-audio in addition to sentence-audio, default tags.
- **F-5.4** "Test connection" button per provider — does a real round-trip and shows latency.
- **F-5.5** Quota dashboard: count of LLM / TTS calls this month, estimated spend (using provider published pricing).
- **F-5.6** Agent debug toggle: when enabled, the popover shows the deep-agent execution trace (each tool call's timing, inputs, outputs, plus any `write_todos` plan it produced) for troubleshooting. Optional integration with LangSmith (`LANGSMITH_TRACING=true` + key) for richer traces.

### 4.6 Export to Anki — primary export path
- **F-6.1** Export produces a **ready-to-import `.apkg` file** (SQLite + media bundle, the native Anki package format). Generated in-browser; user clicks "Export" → file downloads. No external service involved.
- **F-6.2** A custom Anki note type ("Hermes Card") is bundled in the `.apkg` so the front/back templates and CSS travel with the file. First import installs the note type; subsequent imports reuse it.
- **F-6.3** All audio files are packaged inside the `.apkg` (Anki media folder). No external URLs — the deck must work fully offline in Anki.
- **F-6.4** The exported front template embeds the pre-generated MP3 via `[sound:filename.mp3]` with **autoplay on card front** enabled (Anki autoplays `[sound:]` tags by default).
- **F-6.5** Export scope options: "all cards", "only not-yet-exported", "current filter selection". After export, cards are marked with an `exportedAt` timestamp.
- **F-6.6** **Update-on-reimport**: each Hermes card uses a **deterministic Anki GUID** (`hermes::<card.id>`). When the user re-exports a card they've edited, Anki recognizes the GUID and **updates** the existing note in their deck rather than creating a duplicate. (Anki's native behavior on matching GUID is to update fields if they changed.) Audio files use content-hashed filenames so new audio overwrites cleanly while unchanged audio stays cached.
- **F-6.7** Library used for `.apkg` generation: `genanki-js` (or equivalent that builds the SQLite DB + media zip in-browser via `sql.js` + `JSZip`). Documented in the tech spec.

### 4.7 Card format (Anki note type "Hermes Card")

The note type has these fields:
- `Sentence` — the generated English sentence (HTML, with `<mark class="hl">…</mark>` around the term)
- `SentenceTranslation` — the PT-BR translation (HTML, with `<mark class="hl">…</mark>` around the translated term)
- `Term` — the original term (plain text, used for sorting/searching in Anki)
- `TermTranslation` — PT-BR translation of the term alone (plain text)
- `SentenceAudio` — `[sound:<filename>.mp3]` for the front sentence
- `TermAudio` — `[sound:<filename>.mp3]` for the term alone (optional)
- `SourceUrl` — origin URL (hidden on the card; available for reference)

**Front template:**
```
<div class="sentence">{{Sentence}}</div>
{{SentenceAudio}}
```
- Renders the English sentence with the term highlighted (yellow background via the `.hl` CSS class).
- `{{SentenceAudio}}` causes Anki to autoplay the MP3 when the front is shown.

**Back template:**
```
{{FrontSide}}
<hr>
<div class="translation">{{SentenceTranslation}}</div>
<div class="term-pair">
  <span class="term-en">{{Term}}</span> → <span class="term-pt">{{TermTranslation}}</span>
  {{TermAudio}}
</div>
```
- Renders the front, then the PT-BR translation with the corresponding term span highlighted, then the term/translation pair.
- `{{TermAudio}}` plays only when revealing the back (Anki default behavior for back-side `[sound:]` tags).

**CSS (bundled with the note type):**
```css
.card { font-family: -apple-system, system-ui, sans-serif; font-size: 22px; text-align: center; color: #222; background: #fafafa; }
.hl   { background: #fff3a3; padding: 0 2px; border-radius: 3px; }
.translation { color: #555; margin-top: 12px; }
.term-pair { margin-top: 16px; font-size: 18px; color: #444; }
.term-en, .term-pt { font-weight: 600; }
```

### 4.8 Other export formats (secondary)
- **F-8.1** CSV export (term, sentence, sentence_translation, term_translation, audio_filename, tags) — for users who want to inspect or transform the data.
- **F-8.2** JSON export — full fidelity, including highlight offsets and source metadata, for backup / migration.
- **F-8.3** JSON import — restore from backup.

---

## 5. Non-functional requirements

- **N-1 Performance**: capture popover renders in < 100ms (skeleton). Graph nodes stream status to the UI as they complete.
- **N-2 Privacy**: no telemetry, no analytics, no remote calls except to user-configured providers. Privacy policy must explicitly state this.
- **N-3 Security**: API keys stored via `chrome.storage.local` (not `sync`); never logged; redacted in any error reports or LangGraph trace output.
- **N-4 Resilience**: provider down / rate-limited → card still saves with whatever the agent managed to produce; missing fields marked re-runnable.
- **N-5 Cost transparency**: every LLM/TTS call logged with token/character counts; user can see per-card cost.
- **N-6 Offline**: card list, edit, and export work fully offline (audio is already cached); only the enrichment pipeline requires network.
- **N-7 Accessibility**: WCAG 2.1 AA — keyboard navigable, screen-reader labelled, respects `prefers-reduced-motion` and `prefers-color-scheme`.
- **N-8 Anki compatibility**: exported `.apkg` must import cleanly into Anki Desktop (≥ 2.1.50), AnkiMobile, AnkiDroid, and AnkiWeb. Tested on each before release. Re-exporting an edited card must update the existing note in Anki (deterministic GUID), not create a duplicate.
- **N-9 Bundle size**: total extension package target ≤ 10 MB (Chrome Web Store hard limit per package is 10 MB compressed). Heavy modules (`deepagents`, `langchain`, `sql.js` WASM, `JSZip`, `genanki-js`) live behind `import()` so they only load when needed (agent runtime → service worker on first capture; Anki bundler → only when user clicks Export). Realistic budget after gzip: ~4–6 MB. Not a hard performance constraint, but a store-publishing constraint.
- **N-10 Service-worker lifecycle**: agent runs are launched from an **MV3 offscreen document** (`chrome.offscreen` API), not directly in the service worker. This guarantees the agent loop survives the ~30s service-worker idle kill, since offscreen documents have a normal page lifetime. The service worker stays as the message broker between content script ↔ offscreen document. A 60s soft timeout per agent run, after which partial results are saved and the rest is marked re-runnable.
- **N-11 Keys-required**: capture is **disabled until the user has configured at least one LLM provider key AND one TTS provider (key or browser-native)**. Triggering capture before keys are set opens the onboarding/settings page with a clear message. No queueing of un-enriched captures.

---

## 6. UX requirements

- **U-1 Capture popover**: anchored to selection, never obscures it. Auto-flips above/below based on viewport. Dismiss on `Esc` or click-outside.
- **U-2 Live preview**: popover shows the actual rendered Anki front/back (with highlights and a play-audio button) so the user knows exactly what will land in their deck.
- **U-3 Visual language**: single accent color, system font stack, dark/light auto. No emojis in UI chrome.
- **U-4 States are explicit**: every async operation has loading, success, error, and empty states. Per-step loading dots in the popover, one per agent tool call as it streams.
- **U-5 Undo**: deletions and saves are undoable for ~5 seconds via toast.
- **U-6 First-run**: onboarding flow walks through: paste API keys → test connection → capture a sample word on a demo page → export sample `.apkg` → "open this in Anki to verify".
- **U-7 Empty states**: card list with zero cards shows a short tutorial of the capture flow.
- **U-8 Error messages**: human-readable, actionable. "Gemini returned 429 — you've hit your rate limit. [Open settings]" not "Error: 429".

---

## 7. Technical constraints

- **T-1** Manifest V3.
- **T-2** Browser support v1: Chrome + Chromium-derivatives (Edge, Brave, Arc, Opera). Firefox in v1.1.
- **T-3** Stack: TypeScript, React (popups/options), Vite (bundling), Dexie (IndexedDB).
- **T-4** Orchestration: `deepagents` + `langchain` + `@langchain/core` (JS/TS packages, all run in the extension's background service worker). Tool input/output schemas via Zod. Note: combined bundle size is non-trivial — must be code-split so the agent runtime loads only in the service worker, never in content scripts.
- **T-5** Anki packaging: `genanki-js` + `sql.js` + `JSZip`, all running client-side in the service worker.
- **T-6** No bundled remote code (Manifest V3 hard requirement); all logic ships in the extension package, including `sql.js` WASM.
- **T-7** Permissions requested (justify each in store listing):
  - `contextMenus` — right-click menu item
  - `storage` — settings + cards
  - `activeTab` — read selection on the active tab
  - `scripting` — inject the floating action button
  - `downloads` — deliver the exported `.apkg` file
  - `offscreen` — host the deep-agent runtime (see N-10)
  - **Host permissions: requested as `optional_host_permissions`**, granted on demand when the user adds/enables a provider in settings (not at install time). This minimizes the permission ask shown by Chrome at install, improves trust signals during store review, and means installing the extension grants zero outbound network access until the user explicitly opts in.

---

## 8. Provider abstractions

LangChain provides the LLM abstraction natively (consumed by `createDeepAgent` via the `model` option), so the LLM adapter is just a `BaseChatModel` factory. TTS stays bespoke and is wrapped as a `tts_synthesize` deep-agent tool:

```ts
// LLM: thin factory returning a LangChain chat model
function getLLM(settings: LLMSettings): BaseChatModel {
  switch (settings.provider) {
    case 'gemini':    return new ChatGoogleGenerativeAI({ apiKey: settings.apiKey, model: settings.model });
    case 'openai':    return new ChatOpenAI({ apiKey: settings.apiKey, model: settings.model });
    case 'anthropic': return new ChatAnthropic({ apiKey: settings.apiKey, model: settings.model });
    case 'openrouter':return new ChatOpenAI({ apiKey: settings.apiKey, model: settings.model, configuration: { baseURL: 'https://openrouter.ai/api/v1' } });
  }
}

// TTS: bespoke interface
interface TTSProvider {
  synthesize(text: string, voiceId: string): Promise<Blob>; // returns MP3
  listVoices(): Promise<Voice[]>;
  testConnection(): Promise<{ ok: boolean; latencyMs: number }>;
}
```

**v1 LLM providers (via LangChain)**: Gemini (default), OpenAI, Anthropic, OpenRouter.
**v1 TTS providers**: ElevenLabs (default), browser `SpeechSynthesis` (free fallback).
**v1.x stretch TTS**: Google Cloud TTS, OpenAI TTS.

---

## 9. Data model (sketch)

```ts
type HighlightSpan = { start: number; end: number };

type Card = {
  id: string;                    // uuid
  term: string;                  // the EN term as captured
  termTranslation: string;       // PT-BR translation of the term alone
  type: 'word' | 'phrasal_verb';
  termGroupId: string;           // shared by variants of the same term (see F-4.6)
  captureMode: 'A_generated' | 'B_verbatim';  // how the front sentence was produced
  rawContext: string;            // sentence the user originally selected from (Mode A); empty in Mode B
  source: { url: string; title: string; capturedAt: number };

  // Card content (front sentence is generated in Mode A, user-supplied verbatim in Mode B)
  sentence: string;              // FRONT — English sentence
  sentenceHighlight: HighlightSpan;          // span of `term` inside `sentence` (user-picked in Mode B)
  sentenceTranslation: string;   // BACK — PT-BR translation of `sentence`
  sentenceTranslationHighlight: HighlightSpan; // span of translated term

  // Audio (always present after pipeline completes)
  sentenceAudioBlobId: string;   // IndexedDB ref → MP3
  termAudioBlobId?: string;      // optional, if enabled in settings

  // Agent run metadata
  agentRun: {
    status: 'complete' | 'partial' | 'failed';
    toolCalls: { name: string; status: 'done' | 'failed'; at: number; durationMs: number; error?: string }[];
    llm: { provider: string; model: string };
    tts: { provider: string; voiceId: string };
    runId?: string; // LangSmith trace id, when tracing is enabled
  };

  tags: string[];
  exportedAt?: number;           // null = not yet exported to Anki
  ankiGuid: string;              // deterministic: `hermes::${id}` — used for update-on-reimport
  dirtySinceExport?: boolean;    // set when card edited after last export → flagged in next export
};
```

---

## 10. Resolved decisions

1. **Scope**: both single words AND phrasal verbs supported in v1.
2. **TTS voice**: ship with a recommended ElevenLabs voice ID baked in as the default; user can preview/test other voices and switch via the voice selector in settings.
3. **Duplicate handling**: default action is "save as variant" (variants linked via shared `termGroupId`). User can override per-capture.
4. **Anki note type name**: locked to `Hermes Card` (not configurable in v1).
5. **Cost guardrails**: no hard monthly spend cap in v1. The quota dashboard (F-5.5) gives visibility; users self-regulate.
6. **Project name**: `Hermes` is a **placeholder** — must be revisited (and trademark/Chrome-Web-Store-search-checked) before publishing.
7. **Default LLM model**: `gemini-2.5-pro` (Gemini provider). Other providers default to their currently-recommended general-purpose model; user can override per-provider.
8. **Bundle size**: target ≤ 10 MB total package (Chrome Web Store hard limit). Heavy modules lazy-loaded behind `import()`. See N-9.
9. **Service-worker lifecycle**: agent runs hosted in an MV3 offscreen document to survive the SW idle kill. See N-10.
10. **Keys-required**: capture is disabled until the user has configured at least one LLM key + one TTS option (key or browser-native). No queueing of un-enriched captures. See N-11.
11. **Anki re-import**: deterministic GUID per card so re-export updates the existing note rather than duplicating. See F-6.6 and `ankiGuid` in §9.
12. **Host permissions**: requested as `optional_host_permissions`, granted on demand when the user enables a provider in settings (not at install time). See T-7.

---

## 11. Out of scope (explicitly)

- Languages other than EN → PT-BR.
- Built-in SRS / review mode (Anki is the review surface).
- OCR / capturing text from images or PDFs.
- Video subtitle capture (Netflix/YouTube overlay) — interesting v2.
- Cloud sync / shared decks / accounts.
