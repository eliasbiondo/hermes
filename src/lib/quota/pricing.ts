// Approximate provider pricing for the quota dashboard (F-5.5). Numbers are
// rough USD per 1M tokens (LLM) or per 1M characters (TTS). They're hints,
// not invoices — the user "self-regulates" per decision §10.5.

interface LLMPricing {
  input: number;  // USD per 1M input tokens
  output: number; // USD per 1M output tokens
}

const LLM: Record<string, LLMPricing> = {
  // LangChain provider key:model. Conservative defaults.
  'gemini:gemini-2.5-pro': { input: 1.25, output: 5 },
  'gemini:gemini-2.5-flash': { input: 0.075, output: 0.3 },
  'openai:gpt-4o': { input: 2.5, output: 10 },
  'openai:gpt-4o-mini': { input: 0.15, output: 0.6 },
  'anthropic:claude-sonnet-4-6': { input: 3, output: 15 },
  'anthropic:claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
  'openrouter:openai/gpt-4o': { input: 2.5, output: 10 },
};

const TTS: Record<string, number> = {
  // USD per 1M characters
  elevenlabs: 30,
  browser: 0,
};

export function estimateLLMCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const key = `${provider}:${model}`;
  const p = LLM[key] ?? LLM[`${provider}:default`] ?? { input: 1, output: 5 };
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export function estimateTTSCost(provider: string, chars: number): number {
  const rate = TTS[provider] ?? 0;
  return (chars * rate) / 1_000_000;
}
