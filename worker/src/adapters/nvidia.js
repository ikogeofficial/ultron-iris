import { callChatCompletions } from './shared.js';

export const provider = 'nvidia';

export function chat({ key, model, messages, maxTokens, fetchImpl, timeoutMs }) {
  return callChatCompletions({
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    headers: { Authorization: `Bearer ${key}` },
    model,
    messages,
    maxTokens,
    fetchImpl,
    timeoutMs
  });
}
