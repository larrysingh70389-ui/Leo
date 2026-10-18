import assert from 'node:assert/strict';

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.DATABASE_PATH = ':memory:';
process.env.ECONOMY_DATABASE_PATH = ':memory:';

const { config } = await import('../src/config.js');
const {
  getPublicAddressBalance,
  isValidPublicAddress,
  verifyPublicAddress
} = await import('../src/crypto-balance.js');
const originalFetch = globalThis.fetch;
const address = '0x000000000000000000000000000000000000dEaD';

assert.equal(isValidPublicAddress('ethereum', address), true);
assert.equal(isValidPublicAddress('base', '0x123'), false);
assert.equal(isValidPublicAddress('bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'), true);
assert.equal(isValidPublicAddress('litecoin', 'ltc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'), true);
assert.equal(isValidPublicAddress('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), true);
assert.equal(isValidPublicAddress('solana', 'invalid'), false);
await assert.rejects(verifyPublicAddress('ethereum', 'not-an-address'), /not a valid public address format/);
await assert.rejects(getPublicAddressBalance('unknown', address), /Unsupported network/);

config.coingeckoApiKey = '';
config.explorerApiKey = '';
config.explorerApiUrl = '';
const urls = [];
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  urls.push(url);
  if (options.method === 'POST') {
    const body = JSON.parse(options.body);
    if (body.method === 'eth_getBalance') return new Response(JSON.stringify({ result: '0x16345785d8a0000' }));
    if (body.method === 'eth_call') return new Response(JSON.stringify({ result: '0x001312d0' }));
  }
  if (url.hostname === 'base.blockscout.com') {
    return new Response(JSON.stringify({
      status: '1',
      message: 'OK',
      result: Array.from({ length: 25 }, (_, index) => ({ hash: `0x${index}`, blockNumber: String(100 + index) }))
    }));
  }
  const id = url.searchParams.get('ids');
  const prices = { ethereum: { usd: 3000 }, 'usd-coin': { usd: 1 } };
  return new Response(JSON.stringify({ [id]: prices[id] }));
};

try {
  const balance = await getPublicAddressBalance('base', address);
  assert.equal(balance.native.symbol, 'ETH');
  assert.equal(balance.native.amount, '0.1');
  assert.equal(balance.native.usdValue, 300);
  assert.equal(balance.usdc.amount, '1.25');
  assert.equal(balance.usdc.usdValue, 1.25);
  assert.equal(balance.transactions.length, 20);
  assert.equal(new URL(urls.find((url) => url.hostname === 'base.blockscout.com')).searchParams.get('offset'), '20');
  assert.ok(urls.filter((url) => url.hostname === 'api.coingecko.com').every((url) => !url.searchParams.has('x-cg-demo-api-key')));

  const { handleSlashCommand } = await import('../src/prefix.js');
  const slashBalance = [];
  assert.equal(await handleSlashCommand({
    commandName: 'balance',
    user: { id: 'any-user' },
    options: { getString: (name) => name === 'network' ? 'base' : address },
    editReply: async (payload) => slashBalance.push(payload)
  }), true);
  assert.equal(slashBalance[0].embeds[0].data.title, 'Public address on base');
  assert.equal('ephemeral' in slashBalance[0], false);

  urls.length = 0;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    urls.push(url);
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.method === 'getBalance') return new Response(JSON.stringify({ result: { value: 1_500_000_000 } }));
      if (body.method === 'getTokenAccountsByOwner') {
        return new Response(JSON.stringify({ result: { value: [{
          account: { data: { parsed: { info: { tokenAmount: { amount: '2500000' } } } } }
        }] } }));
      }
      if (body.method === 'getSignaturesForAddress') {
        return new Response(JSON.stringify({ result: Array.from({ length: 20 }, (_, index) => ({ signature: `signature-${index}`, slot: index + 1 })) }));
      }
    }
    const id = url.searchParams.get('ids');
    const prices = { solana: { usd: 150 }, 'usd-coin': { usd: 1 } };
    return new Response(JSON.stringify({ [id]: prices[id] }));
  };
  const solana = await getPublicAddressBalance('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  assert.equal(solana.native.amount, 1.5);
  assert.equal(solana.native.usdValue, 225);
  assert.equal(solana.usdc.amount, '2.5');
  assert.equal(solana.transactions.length, 20);
  assert.equal(urls.filter((url) => url.hostname === 'api.mainnet-beta.solana.com').length, 3);

  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify({ result: body.method === 'eth_getBalance' ? '0x0' : '0x0' }));
    }
    if (url.hostname === 'eth.blockscout.com') return new Response(JSON.stringify({ status: '1', result: [] }));
    return new Response('price provider unavailable', { status: 503 });
  };
  const unavailable = await getPublicAddressBalance('ethereum', address);
  assert.equal(unavailable.native.amount, '0');
  assert.equal(unavailable.native.usdValue, null);
  assert.ok(unavailable.warnings.length > 0);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Crypto balance tests passed: address validation, EVM/Solana balances, USDC, public history, prices, and provider errors.');
