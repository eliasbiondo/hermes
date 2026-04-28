// LangChain BaseChatModel factory (§8). Each adapter is dynamically imported
// from the offscreen runtime so providers we don't use don't bloat the bundle.

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LLMSettings } from '@/types/settings';

export async function getLLM(settings: LLMSettings): Promise<BaseChatModel> {
  switch (settings.provider) {
    case 'gemini': {
      const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
      return new ChatGoogleGenerativeAI({
        apiKey: settings.apiKey,
        model: settings.model,
        temperature: 0.2,
      }) as unknown as BaseChatModel;
    }
    case 'openai': {
      const { ChatOpenAI } = await import('@langchain/openai');
      return new ChatOpenAI({
        apiKey: settings.apiKey,
        model: settings.model,
        temperature: 0.2,
      }) as unknown as BaseChatModel;
    }
    case 'anthropic': {
      const { ChatAnthropic } = await import('@langchain/anthropic');
      return new ChatAnthropic({
        apiKey: settings.apiKey,
        model: settings.model,
        temperature: 0.2,
      }) as unknown as BaseChatModel;
    }
    case 'openrouter': {
      const { ChatOpenAI } = await import('@langchain/openai');
      return new ChatOpenAI({
        apiKey: settings.apiKey,
        model: settings.model,
        temperature: 0.2,
        configuration: { baseURL: 'https://openrouter.ai/api/v1' },
      }) as unknown as BaseChatModel;
    }
  }
}
