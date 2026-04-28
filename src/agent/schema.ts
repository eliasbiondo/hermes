// Two schemas:
//   • EnrichmentDraftSchema — what the single structured-output LLM call
//     emits. The model commits to ONE coherent translation choice and emits
//     the EN inflected form, the PT phrase, and the PT lemma all together,
//     so the front highlight, the back highlight, and the back-of-card
//     headword can never disagree.
//   • CardEnrichmentSchema — what the runner assembles after locating the
//     highlight spans (via indexOf on the verbatim substrings) and attaching
//     TTS blob IDs.
//
// Gemini's function-calling rejects JSON Schema with `$ref`, which
// zod-to-json-schema emits when the SAME Zod instance is reused. We avoid
// that by building fresh sub-schemas via factory functions every time.

import { z } from 'zod';

const span = () =>
  z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  });

const TermType = () => z.enum(['word', 'phrasal_verb']);

export const HighlightSpanSchema = span();
export const TermTypeSchema = TermType();

// `.optional()` instead of `.nullish()` because Gemini's function-calling
// JSON Schema rejects `{"type":["string","null"]}` unions — its parser
// expects `type` to be a singular string. `optional` produces a plain
// missing-key, which Gemini accepts.
export const EnrichmentDraftSchema = z.object({
  type: TermType(),
  baseVerb: z.string().optional(),
  particle: z.string().optional(),
  sentence: z.string().min(1),
  termInSentence: z.string().min(1),
  translation: z.string().min(1),
  translatedTerm: z.string().min(1),
  termTranslation: z.string().min(1),
});
export type EnrichmentDraft = z.infer<typeof EnrichmentDraftSchema>;

export const CardEnrichmentSchema = z.object({
  type: TermType(),
  baseVerb: z.string().nullish(),
  particle: z.string().nullish(),
  sentence: z.string().min(1),
  sentenceHighlight: span(),
  sentenceTranslation: z.string().min(1),
  sentenceTranslationHighlight: span(),
  termTranslation: z.string().min(1),
  sentenceAudioBlobId: z.string().min(1),
  termAudioBlobId: z.string().nullish(),
});
export type CardEnrichment = z.infer<typeof CardEnrichmentSchema>;
