import assert from 'node:assert/strict';

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.CLIENT_ID ||= 'test-client';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.OPENAI_MODEL = 'gpt-4o-mini';
process.env.DATABASE_PATH = ':memory:';
process.env.ECONOMY_DATABASE_PATH = ':memory:';

const { askAi } = await import('../src/ai.js');
const { config } = await import('../src/config.js');
const { handleSlashCommand } = await import('../src/prefix.js');
const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
const providerCalls = [];
const logged = [];

config.openAiApiKey = 'test-openai-key';
config.openAiModel = 'gpt-4o-mini';
console.error = (...args) => logged.push(args.map((value) =>
  typeof value === 'string' ? value : JSON.stringify(value)
).join(' '));

try {
  const replies = [];
  const interactionEvents = [];
  let slashInteraction;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    providerCalls.push(url);
    interactionEvents.push('provider');
    assert.match(url, /^https:\/\/api\.openai\.com\//);
    assert.equal(slashInteraction.deferred, true, 'the slash command must be acknowledged before the API call');
    const requestHeaders = new Headers(options.headers);
    assert.ok(requestHeaders.has('authorization'));
    const requestBody = JSON.parse(options.body);
    assert.equal(requestBody.model, 'gpt-4o-mini');
    assert.equal(requestBody.messages.at(-1).content, 'What is a test?');
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Mock OpenAI answer.' } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  slashInteraction = {
    commandName: 'ask',
    user: { id: 'non-owner', bot: false },
    options: { data: [{ name: 'question', type: 3, value: 'What is a test?' }] },
    deferred: false,
    replied: false,
    deferReply: async (...args) => {
      interactionEvents.push('defer');
      assert.equal(args.length, 0, 'deferReply remains public by default');
      slashInteraction.deferred = true;
    },
    editReply: async (payload) => replies.push(payload)
  };

  assert.equal(await handleSlashCommand(slashInteraction), true);
  assert.deepEqual(interactionEvents, ['defer', 'provider']);
  assert.deepEqual(replies, ['Mock OpenAI answer.']);
  assert.ok(providerCalls.every((url) => !url.includes('anthropic')));

  const callsBeforeEmptyPrompt = providerCalls.length;
  await assert.rejects(askAi('   '), /Please provide a question/);
  assert.equal(providerCalls.length, callsBeforeEmptyPrompt, 'empty prompts do not call an AI provider');

  const key = 'test-openai-key';
  const providerDetail = 'private-provider-detail';
  const failureCases = [
    {
      status: 401,
      code: 'invalid_api_key',
      expected: /OpenAI authentication failed/
    },
    {
      status: 429,
      code: 'insufficient_quota',
      expected: /quota or credits/
    },
    {
      status: 429,
      code: 'rate_limit_exceeded',
      expected: /rate limit/
    },
    {
      status: 404,
      code: 'model_not_found',
      expected: /configured OPENAI_MODEL/
    }
  ];

  for (const { status, code, expected } of failureCases) {
    globalThis.fetch = async (input) => {
      providerCalls.push(String(input));
      return new Response(JSON.stringify({
        error: { message: `${providerDetail} ${key}`, code }
      }), { status, headers: { 'Content-Type': 'application/json' } });
    };
    await assert.rejects(askAi('test prompt'), (error) => {
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, new RegExp(`${key}|${providerDetail}`));
      return true;
    });
  }

  globalThis.fetch = async (input) => {
    providerCalls.push(String(input));
    throw new DOMException(`${providerDetail} ${key}`, 'AbortError');
  };
  await assert.rejects(askAi('test prompt'), /timed out/);

  globalThis.fetch = async (input) => {
    providerCalls.push(String(input));
    throw new Error(`${providerDetail} ${key}`);
  };
  await assert.rejects(askAi('test prompt'), /connect to OpenAI/);

  globalThis.fetch = async (input) => {
    providerCalls.push(String(input));
    return new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  await assert.rejects(askAi('test prompt'), /unexpected response/);

  config.openAiApiKey = '';
  await assert.rejects(askAi('test prompt'), /Add OPENAI_API_KEY/);

  const diagnostics = logged.join('\n');
  assert.match(diagnostics, /OpenAI API request failed/);
  assert.doesNotMatch(diagnostics, new RegExp(`${key}|${providerDetail}`));
  assert.ok(providerCalls.every((url) => url.startsWith('https://api.openai.com/')));
  assert.ok(providerCalls.every((url) => !url.includes('anthropic')));

  console.log('AI tests passed: OpenAI SDK routing, public defer, success, safe errors, empty prompts, and no Anthropic calls.');
} finally {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
}
