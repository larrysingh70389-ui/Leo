import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError
} from 'openai';
import { config } from './config.js';

const requestTimeoutMs = 20_000;
const safeErrorCodes = new Set([
  'insufficient_quota',
  'billing_hard_limit_reached',
  'rate_limit_exceeded',
  'invalid_api_key',
  'model_not_found',
  'server_error'
]);

class UnexpectedOpenAIResponseError extends Error {}

function logProviderFailure(error) {
  const details = {};
  if (Number.isInteger(error?.status)) details.status = error.status;
  if (safeErrorCodes.has(error?.code)) details.code = error.code;

  const errorType = error instanceof UnexpectedOpenAIResponseError
    ? 'unexpected_response'
    : error instanceof APIConnectionTimeoutError
    || error?.cause?.name === 'AbortError'
    || error?.cause?.code === 'ETIMEDOUT'
    ? 'timeout'
    : error instanceof APIConnectionError
      ? 'connection'
      : 'api_error';

  console.error('OpenAI API request failed:', { type: errorType, ...details });
}

function classifyOpenAiError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  const code = String(error?.code ?? '').toLowerCase();

  if (status === 429 && [
    'insufficient_quota',
    'billing_hard_limit_reached',
    'credit_balance_exhausted'
  ].includes(code)) {
    return 'OpenAI API quota or credits are unavailable. Check the API account billing and usage.';
  }
  if (status === 429) return 'OpenAI rate limit reached. Please retry later.';
  if (status === 401 || status === 403) return 'OpenAI authentication failed. Check OPENAI_API_KEY.';
  if (status === 404 || code === 'model_not_found') {
    return 'The configured OPENAI_MODEL is not available to this API account. Choose a supported model.';
  }
  if (error instanceof UnexpectedOpenAIResponseError) {
    return 'OpenAI returned an unexpected response. Please try again later.';
  }
  if (error instanceof APIConnectionTimeoutError
    || error?.cause?.name === 'AbortError'
    || error?.cause?.code === 'ETIMEDOUT') {
    return 'The OpenAI request timed out. Please try again.';
  }
  if (error instanceof APIConnectionError) {
    return 'Could not connect to OpenAI. Please check the network and try again.';
  }
  if (status >= 500 || !status) return 'OpenAI is temporarily unavailable. Please retry later.';
  return 'OpenAI request failed. Please try again later.';
}

export async function askAi(prompt, context = '') {
  const question = typeof prompt === 'string' ? prompt.trim() : '';
  if (!question) throw new Error('Please provide a question for /ask.');
  if (!config.openAiApiKey) {
    throw new Error('AI is not configured. Add OPENAI_API_KEY to the runtime environment.');
  }

  try {
    const client = new OpenAI({
      apiKey: config.openAiApiKey,
      timeout: requestTimeoutMs,
      maxRetries: 0,
      fetch: (...args) => globalThis.fetch(...args)
    });
    const response = await client.chat.completions.create({
      model: config.openAiModel,
      messages: [{
        role: 'system',
        content: 'You are a helpful Discord assistant. Be accurate, concise, and easy to understand.'
      }, {
        role: 'user',
        content: context ? `${context}\n\nQuestion: ${question}` : question
      }],
      temperature: 0.4
    });
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new UnexpectedOpenAIResponseError();
    }
    return content.trim();
  } catch (error) {
    logProviderFailure(error);
    throw new Error(classifyOpenAiError(error));
  }
}

export function limitDiscordMessage(text) {
  return text.length > 2000 ? `${text.slice(0, 1997)}...` : text;
}
