// "Hermes Card" Anki note type (§4.7). Locked name for v1 per decision §10.4.

export const HERMES_NOTE_TYPE_NAME = 'Hermes Card';
export const HERMES_DECK_GUID_NAMESPACE = 'hermes';

export const HERMES_FIELDS = [
  'Sentence',
  'SentenceTranslation',
  'Term',
  'TermTranslation',
  'SentenceAudio',
  'TermAudio',
  'SourceUrl',
] as const;

export const HERMES_FRONT_TEMPLATE = `<div class="sentence">{{Sentence}}</div>
{{SentenceAudio}}`;

export const HERMES_BACK_TEMPLATE = `{{FrontSide}}
<hr>
<div class="translation">{{SentenceTranslation}}</div>
<div class="term-pair">
  <span class="term-en">{{Term}}</span> → <span class="term-pt">{{TermTranslation}}</span>
  {{TermAudio}}
</div>`;

export const HERMES_CSS = `.card { font-family: -apple-system, system-ui, sans-serif; font-size: 22px; text-align: center; color: #222; background: #fafafa; }
.hl   { background: #fff3a3; padding: 0 2px; border-radius: 3px; }
.translation { color: #555; margin-top: 12px; }
.term-pair { margin-top: 16px; font-size: 18px; color: #444; }
.term-en, .term-pt { font-weight: 600; }`;

// Stable model + deck IDs so re-imports update rather than create duplicates.
// Anki uses BIGINT IDs; we hash a fixed name into a 64-bit-ish range.
export const HERMES_MODEL_ID = 1700000001;
export const HERMES_DECK_ID = 1700000002;
