# Hermes 🃏

> Turn anything you read into Anki-ready flashcards — straight from your browser, in any language pair.

Hermes is a Chromium extension for vocabulary learners. Highlight a word or sentence on any page, pick how Hermes should phrase the card, and it builds a fully-rendered Anki note with AI-written context, a translation in your fluent language, and a pronunciation clip. Captures stream **directly from your browser to your provider** — nothing routes through a server.

<p align="center">
  <img src="public/icons/icon-128.png" alt="Hermes" width="96" height="96" />
</p>

## Highlights

- **Floating in-page panel.** Click the toolbar icon and a Cuponomia-style panel slides in over the current tab — Library, Archive, and live Queue tabs side-by-side, no Chrome popup chrome.
- **Two capture modes.** *Generate* writes a fresh sentence around the selected term; *Verbatim* keeps your selected sentence and lets you highlight the term inside it.
- **Multi-language.** Pick your **Learning** and **Fluent** languages in settings (English, Portuguese · Brazil, Spanish, French, German, Italian, Dutch, Japanese, Korean, Chinese — Simplified and Traditional, Russian, Polish, Turkish, Arabic). The agent prompt + validation are templated against the chosen pair.
- **Bring your own LLM key.** Gemini · OpenAI · Anthropic · OpenRouter. Keys stay in `chrome.storage.local`, never synced.
- **Bring your own voice.** Microsoft Edge "Read Aloud" (free, neural, English only) or ElevenLabs (paid, multi-language). Audio is cached per `(text, voice, provider)` so re-exports don't re-spend.
- **Anki-native export.** Cards build a real `.apkg` (sql.js + JSZip in an offscreen document) with the bundled *Hermes Card* note type. Filename is `export-YYYYMMDD-HHmm.apkg`. Re-imports update existing notes via deterministic GUIDs instead of duplicating.
- **Privacy by design.** Manifest V3, optional host permissions, no analytics. The capture pipeline never leaves your machine except for the calls you authorise to your own provider.

## How it works

```
┌─ Page ──────────────────────────────────────────────┐
│  Selection  →  Floating button / right-click /     │
│                Ctrl/⌘+Shift+H                       │
│        │                                            │
│        ▼                                            │
│  Capture popover (Mode A or B)                      │
└────────┬────────────────────────────────────────────┘
         │ chrome.runtime.sendMessage
         ▼
┌─ Service worker ────────────────────────────────────┐
│  Routes to offscreen document                      │
└────────┬────────────────────────────────────────────┘
         │ message
         ▼
┌─ Offscreen document ───────────────────────────────┐
│  • LangChain agent (deepagents-style runner)       │
│      ├─ enrich   → JSON draft (sentence,           │
│      │             translation, term, lemma)       │
│      ├─ tts      → sentence audio (Edge / ElevenL.)│
│      └─ tts*term → term audio (back-of-card)       │
│  • sql.js + JSZip → .apkg builder                  │
│  • <a download>  → triggers Save-As dialog         │
└────────────────────────────────────────────────────┘
         │
         ▼
   Dexie/IndexedDB (cards, audio cache, monthly usage)
```

## Repository layout

```
src/
├─ agent/             # LangChain runner, prompt template, schema
├─ anki/              # .apkg builder + note-type templates
├─ background/        # MV3 service worker (message broker, action toggle)
├─ components/        # Shared shadcn-style Select + Checkbox
├─ content/           # Floating button, capture popover, panel host
├─ edit/              # Card-editor SPA (one card → tweak fields, regenerate)
├─ lib/
│  ├─ providers/      # LLM/TTS host-permissions + connection tests
│  ├─ quota/          # Per-month usage roll-up
│  ├─ storage/        # Dexie schema + settings store
│  ├─ tts/            # Edge + ElevenLabs adapters, audio cache, mp3 encoder
│  └─ text/           # Sentence extraction
├─ offscreen/         # Hosts the agent runner + .apkg build
├─ onboarding/        # First-run wizard
├─ options/           # Settings SPA
├─ popup/             # The in-page floating panel (loaded inside an iframe)
└─ types/             # Shared TS types
public/icons/         # Toolbar / install icons (rendered by scripts/build-icons.mjs)
scripts/
└─ build-icons.mjs    # Pure-Node PNG generator for the H-monogram tile
```

## Getting started

```bash
npm install
npm run dev          # Vite + crxjs in watch mode
```

Then in Chrome / Edge:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and pick the project's `dist/` directory.
3. Grant any provider host permissions Hermes asks for the first time you select a provider in settings.

Production build:

```bash
npm run build        # outputs dist/
npm run typecheck    # tsc strict, no emit
```

To regenerate the toolbar icon set (if you change the brand glyph):

```bash
node scripts/build-icons.mjs
```

## Configuration

Open the extension's options page (`chrome://extensions` → Hermes → *Details* → *Extension options*).

| Section | Key knobs |
| --- | --- |
| **Languages** | Pick Learning + Fluent. Drives the agent prompt and the available voice providers. |
| **Language model** | Gemini / OpenAI / Anthropic / OpenRouter. API key is stored locally (never synced). |
| **Voice** | Edge (English only, free) or ElevenLabs (multi-language, paid). |
| **Anki export** | Default deck name and tags applied to every export. |
| **Capture** | Toggles for the floating button, right-click menu, and `Ctrl/⌘+Shift+H` shortcut. |
| **Usage** | Per-month roll-up of LLM calls, TTS calls, tokens, and estimated USD spend. |
| **Backup** | JSON (full-fidelity) or CSV (inspection) export, plus JSON import. |
| **Developer** | Stream the agent steps live in the popover; optional LangSmith tracing. |

## Tech stack

| Layer | Tech |
| --- | --- |
| Build | Vite + `@crxjs/vite-plugin`, `vite-plugin-node-polyfills` |
| UI    | React 19, plain CSS with `lab(...)` color tokens (no design-system framework) |
| State / storage | Dexie (IndexedDB), `chrome.storage.local` for settings |
| Agent runtime | LangChain (`@langchain/core`, `@langchain/openai`, `@langchain/anthropic`, `@langchain/google-genai`, `langchain`), Zod schemas |
| TTS | Microsoft Edge "Read Aloud" (WebSocket) and ElevenLabs REST |
| Audio encoding | `@breezystack/lamejs` (MP3) |
| Anki export | `sql.js` (collection.anki2) + `jszip` |

## Privacy & security

- **No backend.** The only network calls Hermes makes are to your chosen LLM provider, the TTS provider you picked, and the page you're capturing from.
- **Keys never leave your browser.** They're stored in `chrome.storage.local` (not `sync`).
- **Optional host permissions.** Hermes only asks for a provider's host once you enable it in settings.
- **Cards stay local.** Saved cards live in IndexedDB until you explicitly export them.

## Acknowledgements

The capture flow + popover UX is inspired by Cuponomia's in-page panel pattern. The card-editor structure draws from Anki's note-type model. The agent loop's design borrows ideas from the deepagents pattern.

## License

[MIT](LICENSE) © 2026 Elias Biondo
