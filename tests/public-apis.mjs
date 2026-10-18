import assert from 'node:assert/strict';

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.CLIENT_ID ||= 'test-client';
process.env.EXPLORER_API_KEY = 'test-explorer-key';
process.env.EXPLORER_API_URL = '';
process.env.COINGECKO_API_KEY = 'test-coingecko-key';
process.env.DATABASE_PATH = ':memory:';
process.env.ECONOMY_DATABASE_PATH = ':memory:';

const { config } = await import('../src/config.js');
const { getCoinPrice, getWalletHistory } = await import('../src/public-apis.js');
const originalFetch = globalThis.fetch;
let requestedUrl;
let requestedOptions;

globalThis.fetch = async (url, options) => {
  requestedUrl = new URL(url);
  requestedOptions = options;
  return new Response(JSON.stringify({ status: '1', message: 'OK', result: [] }), { status: 200 });
};

try {
  globalThis.fetch = async (url, options) => {
    requestedUrl = new URL(url);
    requestedOptions = options;
    return new Response(JSON.stringify({ bitcoin: { usd: 65000 } }), { status: 200 });
  };
  assert.equal(await getCoinPrice('bitcoin'), 65000);
  assert.equal(requestedOptions.headers['x-cg-demo-api-key'], 'test-coingecko-key');

  globalThis.fetch = async (url, options) => {
    requestedUrl = new URL(url);
    requestedOptions = options;
    return new Response(JSON.stringify({ status: '1', message: 'OK', result: [] }), { status: 200 });
  };
  const history = await getWalletHistory('0x000000000000000000000000000000000000dEaD', 'arbitrum');
  assert.deepEqual(history.transactions, []);
  assert.equal(requestedUrl.origin + requestedUrl.pathname, 'https://api.etherscan.io/v2/api');
  assert.equal(requestedUrl.searchParams.get('chainid'), '42161');
  assert.equal(requestedUrl.searchParams.get('action'), 'txlist');
  assert.equal(requestedUrl.searchParams.get('apikey'), 'test-explorer-key');

  config.explorerApiKey = '';
  await assert.rejects(
    getWalletHistory('0x000000000000000000000000000000000000dEaD', 'ethereum'),
    /EXPLORER_API_KEY is required/
  );

  config.explorerApiKey = 'test-explorer-key';
  globalThis.fetch = async () => {
    throw new TypeError('request failed for URL containing test-explorer-key');
  };
  await assert.rejects(
    getWalletHistory('0x000000000000000000000000000000000000dEaD', 'ethereum'),
    (error) => error.message === 'Explorer request failed: TypeError.'
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Public API tests passed: Etherscan v2 chain routing and missing-key handling.');
