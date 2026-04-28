// Single-call card enrichment. One structured-output LLM round-trip emits
// the full draft (sentence, EN inflected form, PT translation, PT highlight
// phrase, PT lemma, type metadata). The runner then locates the highlight
// spans via exact-substring indexOf — no character-index drift across
// independent tool calls. TTS runs as 1–2 separate synth calls (audio is
// content-addressed and cached). Lives in the offscreen doc per N-10.

import { makeLogger } from '@/lib/log';
import { getLLM } from './llm-factory';
import {
  CardEnrichmentSchema,
  EnrichmentDraftSchema,
  type CardEnrichment,
  type EnrichmentDraft,
} from './schema';
import { getTTS } from '@/lib/tts/factory';
import { getOrSynthesize } from '@/lib/tts/audio-cache';
import { recordUsage } from '@/lib/quota/store';
import { estimateLLMCost, estimateTTSCost } from '@/lib/quota/pricing';
import type { AgentRequest, AgentStreamEvent } from '@/types/messages';
import type { AgentToolCall, HighlightSpan } from '@/types/card';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { TTSProvider } from '@/lib/tts/types';

const log = makeLogger('agent');

const SOFT_TIMEOUT_MS = 180_000;
const ENRICHMENT_RETRIES = 2;

export interface RunResult {
  status: 'complete' | 'partial' | 'failed';
  enrichment?: CardEnrichment;
  toolCalls: AgentToolCall[];
  error?: string;
}

export async function runEnrichment(
  req: AgentRequest,
  emit: (e: AgentStreamEvent) => void,
): Promise<RunResult> {
  const runStart = Date.now();
  const settings = req.settings;
  log.log(
    `start runId=${req.runId} mode=${req.mode} term=${JSON.stringify(req.term ?? '')} ` +
      `llm=${settings.llm.provider}/${settings.llm.model} ` +
      `tts=${settings.tts.provider}/${settings.tts.voiceId} ` +
      `genTermAudio=${settings.tts.generateTermAudio}`,
  );

  const toolCalls: AgentToolCall[] = [];
  const runStep = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const at = Date.now();
    emit({ runId: req.runId, kind: 'tool_start', tool: name, at });
    try {
      const v = await fn();
      const durationMs = Date.now() - at;
      toolCalls.push({ name, status: 'done', at, durationMs });
      emit({ runId: req.runId, kind: 'tool_end', tool: name, at, durationMs });
      return v;
    } catch (e) {
      const durationMs = Date.now() - at;
      const error = errMsg(e);
      toolCalls.push({ name, status: 'failed', at, durationMs, error });
      emit({ runId: req.runId, kind: 'tool_error', tool: name, at, durationMs, error });
      throw e;
    }
  };

  try {
    const llm = await getLLM(settings.llm);
    const tts = await getTTS(settings.tts);
    log.log(`adapters loaded in ${Date.now() - runStart}ms`);

    const draft = await withTimeout(
      runStep('enrich', () => generateDraft(llm, req, settings.llm)),
      SOFT_TIMEOUT_MS,
    );

    const sentenceHighlight = locate(draft.sentence, draft.termInSentence, 'termInSentence');
    const sentenceTranslationHighlight = locate(
      draft.translation,
      draft.translatedTerm,
      'translatedTerm',
    );

    const sentenceTts = await runStep('tts_synthesize', () =>
      synthesizeAndRecord(draft.sentence, settings.tts.voiceId, settings.tts.provider, tts),
    );

    let termAudioBlobId: string | undefined;
    if (settings.tts.generateTermAudio) {
      const r = await runStep('tts_synthesize_term', () =>
        synthesizeAndRecord(
          draft.termTranslation,
          settings.tts.voiceId,
          settings.tts.provider,
          tts,
        ),
      );
      termAudioBlobId = r.blobId;
    }

    const enrichment: CardEnrichment = {
      type: draft.type,
      baseVerb: draft.baseVerb ?? null,
      particle: draft.particle ?? null,
      sentence: draft.sentence,
      sentenceHighlight,
      sentenceTranslation: draft.translation,
      sentenceTranslationHighlight,
      termTranslation: draft.termTranslation,
      sentenceAudioBlobId: sentenceTts.blobId,
      termAudioBlobId,
    };

    const parsed = CardEnrichmentSchema.safeParse(enrichment);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ');
      log.warn(`final enrichment failed schema: ${issues}`);
      return { status: 'partial', toolCalls, error: `Schema validation failed: ${issues}` };
    }

    const guard = guardEnrichment(parsed.data, req);
    if (!guard.ok) {
      log.warn(`quality guard rejected: ${guard.reason}`);
      return { status: 'partial', toolCalls, error: guard.reason };
    }

    log.log(`done; total=${Date.now() - runStart}ms toolCalls=${toolCalls.length}`);
    return { status: 'complete', enrichment: parsed.data, toolCalls };
  } catch (e) {
    const msg = errMsg(e);
    const stack = e instanceof Error && e.stack ? `\n${e.stack}` : '';
    log.error(`run failed after ${Date.now() - runStart}ms: ${msg}${stack}`);
    return { status: 'failed', toolCalls, error: msg };
  }
}

async function generateDraft(
  llm: BaseChatModel,
  req: AgentRequest,
  llmMeta: { provider: string; model: string },
): Promise<EnrichmentDraft> {
  let lastErr: unknown;
  let extraHint = '';
  for (let attempt = 1; attempt <= ENRICHMENT_RETRIES + 1; attempt++) {
    const prompt = buildPrompt(req, extraHint);
    const start = Date.now();
    try {
      const structured = (
        llm as unknown as {
          withStructuredOutput: (s: typeof EnrichmentDraftSchema) => BaseChatModel;
        }
      ).withStructuredOutput(EnrichmentDraftSchema);
      const raw = await structured.invoke(prompt);
      const draft = EnrichmentDraftSchema.parse(raw);
      const durationMs = Date.now() - start;

      const inputChars = prompt.length;
      const outputChars = JSON.stringify(draft).length;
      const inputTokens = Math.ceil(inputChars / 4);
      const outputTokens = Math.ceil(outputChars / 4);
      await recordUsage({
        ts: start,
        kind: 'llm',
        provider: llmMeta.provider,
        model: llmMeta.model,
        inputChars,
        outputChars,
        inputTokens,
        outputTokens,
        durationMs,
        estCostUSD: estimateLLMCost(llmMeta.provider, llmMeta.model, inputTokens, outputTokens),
      });

      const violation = checkDraft(req, draft);
      if (violation) {
        log.warn(`enrich attempt ${attempt} rejected: ${violation}`);
        extraHint =
          `Your previous JSON was rejected: ${violation}\n` +
          `Re-emit the full JSON object, fixing this issue. The verbatim-substring rule is mandatory.`;
        lastErr = new Error(violation);
        continue;
      }

      log.log(`enrich draft ok in ${durationMs}ms (attempt ${attempt})`);
      return draft;
    } catch (e) {
      lastErr = e;
      const msg = errMsg(e);
      log.warn(`enrich attempt ${attempt} threw: ${msg}`);
      extraHint =
        `Your previous attempt threw: ${msg}\n` +
        `Produce a single JSON object that exactly matches the schema.`;
    }
  }
  throw lastErr ?? new Error('enrich: exhausted retries with no error captured');
}

function buildPrompt(req: AgentRequest, extraHint: string): string {
  const inputs: Record<string, unknown> = { mode: req.mode, term: req.term };
  if (req.rawContext) inputs.rawContext = req.rawContext;
  if (req.sentence) inputs.sentence = req.sentence;
  if (req.termSpan) inputs.termSpan = req.termSpan;
  if (req.termType) inputs.termTypeHint = req.termType;

  return `You are Hermes, a vocabulary-card enricher for a Brazilian Portuguese learner of English.

Produce a SINGLE JSON object that satisfies this schema:

{
  "type": "word" | "phrasal_verb",
  "baseVerb": string | null,        // only when type === "phrasal_verb" (the bare verb, e.g. "set")
  "particle": string | null,        // only when type === "phrasal_verb" (everything after, e.g. "aside")
  "sentence": string,               // EN sentence shown on the card front
  "termInSentence": string,         // VERBATIM substring of "sentence" — the inflected form as it appears
  "translation": string,            // PT-BR translation of "sentence"
  "translatedTerm": string,         // VERBATIM substring of "translation" — the PT phrase that conveys the EN term
  "termTranslation": string         // PT-BR lemma form for the back of the flashcard
}

# Mode A (term + optional rawContext provided, no sentence)
- Write ONE natural, idiomatic EN sentence (12–22 words) using the term in a context where the meaning is unambiguous.
- The term may be inflected (tense/number/person). For phrasal verbs, keep verb + particle adjacent.

# Mode B (sentence + termSpan provided)
- Copy the input "sentence" VERBATIM into the output. Do not paraphrase, fix typos, or change punctuation.
- termInSentence MUST equal sentence.slice(termSpan.start, termSpan.end) exactly.

# Verbatim-substring rule (MANDATORY)
- "termInSentence" MUST be a contiguous substring of "sentence" — same letters, same case, same punctuation. The runner locates it by exact substring match (case-insensitive fallback).
- "translatedTerm" MUST be a contiguous substring of "translation" — same letters, same accents, same case.
- Do NOT emit a lemma or a paraphrase here; emit the form as it actually appears.

# Phrasal-verb rule (MANDATORY)
- Classify as "phrasal_verb" only when EN is verb + 1–2 particles forming one lexical unit ("look after", "come up with", "set aside", "called on", "ran into"). Idioms / prepositional phrases like "through the press" are "word".
- For phrasal verbs, set baseVerb (bare verb) and particle (everything after). e.g. "came up with" → baseVerb "come", particle "up with".
- "translatedTerm" MUST cover the FULL PT phrase that translates the phrasal verb, not just the verb head:
    EN "set aside"   → translatedTerm "deixar de lado" (NOT "deixar")
    EN "look after"  → translatedTerm "cuidar"        (or "cuidar de" if the "de" is adjacent in the sentence)
    EN "came up with"→ translatedTerm "inventou"      (single PT verb covers it)

# Consistency rule (MANDATORY)
- "termTranslation" is the lemma form of "translatedTerm" — same lexical content, normalized to dictionary/infinitive form. It must not pick a different translation than the one used in the sentence.
    translatedTerm "chamou"          → termTranslation "chamar"
    translatedTerm "deixar de lado"  → termTranslation "deixar de lado"
    translatedTerm "pela imprensa"   → termTranslation "pela imprensa"
    translatedTerm "inventou"        → termTranslation "inventar"
    translatedTerm "resistiram"      → termTranslation "resistir"

# Echo guards
- "translation" must be Portuguese — never echo the English sentence.
- "translatedTerm" and "termTranslation" must be Portuguese — never echo the English term.

# Worked examples

Example A1 (mode A, single word, past tense):
  Inputs: { mode: "A", term: "endure" }
  → {
      "type": "word",
      "baseVerb": null,
      "particle": null,
      "sentence": "The ancient ruins have endured centuries of harsh weather and still stand proudly today.",
      "termInSentence": "endured",
      "translation": "As ruínas antigas resistiram a séculos de clima adverso e ainda permanecem orgulhosas hoje.",
      "translatedTerm": "resistiram",
      "termTranslation": "resistir"
    }

Example A2 (mode A, phrasal verb):
  Inputs: { mode: "A", term: "set aside" }
  → {
      "type": "phrasal_verb",
      "baseVerb": "set",
      "particle": "aside",
      "sentence": "The committee decided to set aside the proposal for further review at a later date.",
      "termInSentence": "set aside",
      "translation": "O comitê decidiu deixar de lado a proposta para uma análise mais aprofundada em uma data posterior.",
      "translatedTerm": "deixar de lado",
      "termTranslation": "deixar de lado"
    }

Example A3 (mode A, prepositional phrase — NOT a phrasal verb):
  Inputs: { mode: "A", term: "through the press" }
  → {
      "type": "word",
      "baseVerb": null,
      "particle": null,
      "sentence": "The company released the controversial news through the press to reach a wider audience.",
      "termInSentence": "through the press",
      "translation": "A empresa divulgou a notícia controversa pela imprensa para alcançar um público mais amplo.",
      "translatedTerm": "pela imprensa",
      "termTranslation": "pela imprensa"
    }

Example B1 (mode B, verbatim sentence):
  Inputs: { mode: "B", sentence: "She had to look after her brother all weekend.", termSpan: { start: 14, end: 24 }, term: "look after" }
  → {
      "type": "phrasal_verb",
      "baseVerb": "look",
      "particle": "after",
      "sentence": "She had to look after her brother all weekend.",
      "termInSentence": "look after",
      "translation": "Ela teve que cuidar do irmão o fim de semana inteiro.",
      "translatedTerm": "cuidar",
      "termTranslation": "cuidar de"
    }

Inputs:
${JSON.stringify(inputs)}
${extraHint ? `\n${extraHint}` : ''}
Return ONLY the JSON object — no prose, no markdown.`;
}

function checkDraft(req: AgentRequest, d: EnrichmentDraft): string | null {
  if (!isSubstringCI(d.sentence, d.termInSentence)) {
    return `termInSentence "${d.termInSentence}" is not a contiguous substring of sentence "${d.sentence}".`;
  }
  if (!isSubstringCI(d.translation, d.translatedTerm)) {
    return `translatedTerm "${d.translatedTerm}" is not a contiguous substring of translation "${d.translation}".`;
  }
  if (sameText(d.translation, d.sentence)) {
    return 'translation is identical to sentence — output must be Portuguese, not English.';
  }
  if (sameText(d.translatedTerm, d.termInSentence)) {
    return 'translatedTerm is identical to termInSentence — must be Portuguese, not English.';
  }
  if (sameText(d.termTranslation, d.termInSentence)) {
    return 'termTranslation is identical to termInSentence — must be Portuguese, not English.';
  }
  if (req.term && sameText(d.termTranslation, req.term)) {
    return `termTranslation "${d.termTranslation}" is identical to the input English term — must be Portuguese.`;
  }
  if (req.mode === 'B' && req.sentence && d.sentence !== req.sentence) {
    return `Mode B sentence must be returned verbatim. Expected: "${req.sentence}".`;
  }
  if (req.mode === 'B' && req.sentence && req.termSpan) {
    const expected = req.sentence.slice(req.termSpan.start, req.termSpan.end);
    if (d.termInSentence !== expected) {
      return `Mode B termInSentence must equal sentence.slice(termSpan) = "${expected}", got "${d.termInSentence}".`;
    }
  }
  if (d.type === 'phrasal_verb' && (!d.baseVerb || !d.particle)) {
    return 'phrasal_verb must include both baseVerb and particle.';
  }
  return null;
}

function locate(haystack: string, needle: string, label: string): HighlightSpan {
  let idx = haystack.indexOf(needle);
  if (idx < 0) idx = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) {
    throw new Error(`locate: ${label} "${needle}" not found in "${haystack}"`);
  }
  return { start: idx, end: idx + needle.length };
}

async function synthesizeAndRecord(
  text: string,
  voiceId: string,
  providerName: string,
  tts: TTSProvider,
): Promise<{ blobId: string }> {
  const start = Date.now();
  const { blobId, cached } = await getOrSynthesize(text, voiceId, providerName, tts);
  if (!cached) {
    await recordUsage({
      ts: start,
      kind: 'tts',
      provider: providerName,
      voiceId,
      inputChars: text.length,
      durationMs: Date.now() - start,
      estCostUSD: estimateTTSCost(providerName, text.length),
    });
  }
  return { blobId };
}

// Refuse to save a card whose PT-BR fields are just the English source. The
// echo guards inside checkDraft already block this, but a final guard stops
// any provider quirk from sneaking through after schema parse.
function guardEnrichment(
  e: CardEnrichment,
  req: AgentRequest,
): { ok: true } | { ok: false; reason: string } {
  const term = (req.term ?? '').trim().toLowerCase();
  const sentence = (e.sentence ?? '').trim().toLowerCase();
  const termTr = e.termTranslation.trim().toLowerCase();
  const sentTr = e.sentenceTranslation.trim().toLowerCase();
  if (term && termTr === term) {
    return {
      ok: false,
      reason: `termTranslation "${e.termTranslation}" is identical to the English term — try regenerating.`,
    };
  }
  if (sentence && sentTr === sentence) {
    return {
      ok: false,
      reason: `sentenceTranslation is identical to the English sentence — try regenerating.`,
    };
  }
  const enHi = e.sentence.slice(e.sentenceHighlight.start, e.sentenceHighlight.end).trim().toLowerCase();
  const ptHi = e.sentenceTranslation
    .slice(e.sentenceTranslationHighlight.start, e.sentenceTranslationHighlight.end)
    .trim()
    .toLowerCase();
  if (enHi && ptHi && enHi === ptHi) {
    return {
      ok: false,
      reason: `Translation highlight "${ptHi}" is identical to source highlight — alignment is wrong.`,
    };
  }
  return { ok: true };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`agent run exceeded ${ms}ms soft timeout`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function isSubstringCI(haystack: string, needle: string): boolean {
  return haystack.includes(needle) || haystack.toLowerCase().includes(needle.toLowerCase());
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
