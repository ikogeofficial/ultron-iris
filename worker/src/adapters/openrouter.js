import { callChatCompletions, foldSystemIntoUser } from './shared.js';

export const provider = 'openrouter';

export function chat({ key, model, messages, maxTokens, fetchImpl, timeoutMs }) {
  const msgs = /gemma/i.test(model) ? foldSystemIntoUser(messages) : messages;
  return callChatCompletions({
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: { Authorization: `Bearer ${key}`, 'X-Title': 'Ultron Iris' },
    model,
    messages: msgs,
    maxTokens,
    fetchImpl,
    timeoutMs
  });
}
