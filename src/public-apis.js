import { config } from './config.js';

const networks = {
  ethereum: { rpcUrl: 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io' },
  polygon: { rpcUrl: 'https://polygon-bor-rpc.publicnode.com', explorer: 'https://polygonscan.com' },
  arbitrum: { rpcUrl: 'https://arbitrum-one-rpc.publicnode.com', explorer: 'https://arbiscan.io' },
  base: { rpcUrl: 'https://base-rpc.publicnode.com', explorer: 'https://basescan.org' },
  optimism: { rpcUrl: 'https://optimism-rpc.publicnode.com', explorer: 'https://optimistic.etherscan.io' }
};

const explorerChainIds = {
  ethereum: '1',
  polygon: '137',
  arbitrum: '42161',
  base: '8453',
  optimism: '10'
};

export async function getCoinPrice(id, currency = 'usd') {
  const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=${encodeURIComponent(currency)}`, {
    headers: config.coingeckoApiKey ? { 'x-cg-demo-api-key': config.coingeckoApiKey } : {},
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`CoinGecko returned HTTP ${response.status}.`);
  const value = (await response.json())[id]?.[currency];
  if (typeof value !== 'number') throw new Error(`No ${currency.toUpperCase()} price is available for ${id}.`);
  return value;
}

export async function getTokenInfo(id) {
  const response = await fetch(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`, {
    headers: config.coingeckoApiKey ? { 'x-cg-demo-api-key': config.coingeckoApiKey } : {},
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`CoinGecko returned HTTP ${response.status}.`);
  const data = await response.json();
  return {
    name: data.name,
    symbol: data.symbol?.toUpperCase(),
    marketCap: data.market_data?.market_cap?.usd,
    price: data.market_data?.current_price?.usd,
    website: data.links?.homepage?.find(Boolean) || null
  };
}

export async function convertAmount(amount, from, to) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Conversion amount must be a positive number.');
  const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(from)},${encodeURIComponent(to)}&vs_currencies=usd`, {
    headers: config.coingeckoApiKey ? { 'x-cg-demo-api-key': config.coingeckoApiKey } : {},
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`CoinGecko returned HTTP ${response.status}.`);
  const data = await response.json();
  const fromPrice = data[from]?.usd;
  const toPrice = data[to]?.usd;
  if (typeof fromPrice !== 'number' || typeof toPrice !== 'number') throw new Error('A conversion price is unavailable.');
  return { result: (amount * fromPrice) / toPrice, fromPrice, toPrice };
}

export function getAsset(coin, network) {
  return config.walletAssets.find((asset) =>
    asset.coin?.toLowerCase() === coin.toLowerCase() && asset.network?.toLowerCase() === network.toLowerCase()
  );
}

export function getNetwork(network, asset) {
  const key = network.toLowerCase();
  const configured = asset || config.walletAssets.find((candidate) => candidate.network?.toLowerCase() === key);
  const defaults = networks[key];
  const rpcUrl = configured?.rpcUrl || defaults?.rpcUrl;
  const explorer = configured?.explorerUrl || defaults?.explorer;
  if (!rpcUrl || !explorer) throw new Error(`No public provider is configured for ${network}.`);
  return { rpcUrl, explorer };
}

export async function getTransaction(hash, network) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error('Invalid transaction hash.');
  const { rpcUrl } = getNetwork(network);
  const transaction = await rpc(rpcUrl, 'eth_getTransactionByHash', [hash]);
  if (!transaction) throw new Error('Transaction was not found on that network.');
  const receipt = await rpc(rpcUrl, 'eth_getTransactionReceipt', [hash]);
  return { transaction, receipt };
}

export async function getWalletHistory(address, network, limit = 5) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error('Invalid public wallet address.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Transaction history limit must be between 1 and 20.');
  const asset = config.walletAssets.find((candidate) => candidate.network?.toLowerCase() === network.toLowerCase());
  const { explorer } = getNetwork(network, asset);
  const usesDefaultExplorerApi = !config.explorerApiUrl;
  if (usesDefaultExplorerApi && !config.explorerApiKey) {
    throw new Error('EXPLORER_API_KEY is required for transaction history with the default Etherscan API.');
  }
  const apiBase = config.explorerApiUrl || 'https://api.etherscan.io/v2/api';
  const url = new URL(apiBase);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'txlist');
  url.searchParams.set('address', address);
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', String(limit));
  url.searchParams.set('sort', 'desc');
  if (usesDefaultExplorerApi) {
    const chainId = explorerChainIds[network.toLowerCase()];
    if (!chainId) throw new Error(`No Etherscan chain ID is configured for ${network}.`);
    url.searchParams.set('chainid', chainId);
  }
  if (config.explorerApiKey) url.searchParams.set('apikey', config.explorerApiKey);
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch (error) {
    throw new Error(`Explorer request failed: ${error instanceof Error ? error.name : 'unknown error'}.`);
  }
  if (!response.ok) throw new Error(`Explorer returned HTTP ${response.status}.`);
  const data = await response.json();
  if (!Array.isArray(data.result)) throw new Error(data.message || 'Explorer history is unavailable.');
  return { explorer, transactions: data.result };
}

export async function getReceiptStatus(hash, network) {
  const { receipt } = await getTransaction(hash, network);
  return receipt?.status === '0x1' ? 'confirmed' : receipt?.status === '0x0' ? 'failed' : 'pending';
}

export function explorerLink(type, value, network) {
  if (type !== 'address' && type !== 'tx') throw new Error('Type must be address or tx.');
  const { explorer } = getNetwork(network);
  if (type === 'address' && !/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error('Invalid public address.');
  if (type === 'tx' && !/^0x[a-fA-F0-9]{64}$/.test(value)) throw new Error('Invalid transaction hash.');
  return `${explorer}/${type === 'tx' ? 'tx' : 'address'}/${value}`;
}

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Public RPC returned HTTP ${response.status}.`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || 'Public RPC returned an error.');
  return body.result;
}
