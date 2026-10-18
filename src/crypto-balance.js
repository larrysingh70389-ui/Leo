import { getCoinPrice, getNetwork, getWalletHistory } from './public-apis.js';
import { config } from './config.js';

const evmNetworks = new Set(['ethereum', 'base', 'arbitrum', 'polygon']);
const networkSettings = {
  bitcoin: {
    symbol: 'BTC',
    priceId: 'bitcoin',
    api: 'https://blockstream.info/api'
  },
  litecoin: {
    symbol: 'LTC',
    priceId: 'litecoin',
    api: 'https://litecoinspace.org/api'
  },
  solana: {
    symbol: 'SOL',
    priceId: 'solana',
    rpc: 'https://api.mainnet-beta.solana.com',
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  },
  ethereum: {
    symbol: 'ETH',
    priceId: 'ethereum',
    usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    explorer: 'https://eth.blockscout.com/api'
  },
  base: {
    symbol: 'ETH',
    priceId: 'ethereum',
    usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    explorer: 'https://base.blockscout.com/api'
  },
  arbitrum: {
    symbol: 'ETH',
    priceId: 'ethereum',
    usdc: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    explorer: 'https://arbitrum.blockscout.com/api'
  },
  polygon: {
    symbol: 'POL',
    priceId: 'polygon-ecosystem-token',
    usdc: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    explorer: 'https://polygon.blockscout.com/api'
  }
};

const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function isSupportedBalanceNetwork(network) {
  return Object.hasOwn(networkSettings, String(network).toLowerCase());
}

export function isValidPublicAddress(network, address) {
  const normalizedNetwork = String(network).toLowerCase();
  if (evmNetworks.has(normalizedNetwork)) return /^0x[a-fA-F0-9]{40}$/.test(address);
  if (normalizedNetwork === 'solana') {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false;
    return decodeBase58(address).length === 32;
  }
  if (normalizedNetwork === 'bitcoin') {
    return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)
      || isBech32Address(address, 'bc1');
  }
  if (normalizedNetwork === 'litecoin') {
    return /^[LM3][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)
      || isBech32Address(address, 'ltc1');
  }
  return false;
}

function isBech32Address(address, prefix) {
  const isAllLowerOrUpper = address === address.toLowerCase() || address === address.toUpperCase();
  return isAllLowerOrUpper && new RegExp(`^${prefix}[a-z0-9]{11,71}$`, 'i').test(address);
}

function decodeBase58(value) {
  let number = 0n;
  for (const character of value) {
    const digit = base58Alphabet.indexOf(character);
    if (digit < 0) return new Uint8Array();
    number = number * 58n + BigInt(digit);
  }
  const bytes = [];
  while (number > 0n) {
    bytes.unshift(Number(number & 0xffn));
    number >>= 8n;
  }
  for (const character of value) {
    if (character !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export async function verifyPublicAddress(network, address, asset = null) {
  const normalizedNetwork = String(network).toLowerCase();
  if (!isValidPublicAddress(normalizedNetwork, address)) {
    throw new Error(`That is not a valid public address format for ${normalizedNetwork}.`);
  }
  if (asset && !assetSupportsNetwork(asset, normalizedNetwork)) {
    throw new Error(`${asset.toUpperCase()} is not supported on ${normalizedNetwork}.`);
  }

  await getNativeBalance(normalizedNetwork, address);
  return true;
}

function assetSupportsNetwork(asset, network) {
  if (asset === 'usdc') return network === 'solana' || evmNetworks.has(network);
  return asset === network;
}

export async function getPublicAddressBalance(network, address) {
  const normalizedNetwork = String(network).toLowerCase();
  const settings = networkSettings[normalizedNetwork];
  if (!settings) throw new Error(`Unsupported network: ${network}.`);
  if (!isValidPublicAddress(normalizedNetwork, address)) {
    throw new Error(`Invalid public ${normalizedNetwork} address.`);
  }

  const [rawNative, historyResult, nativePriceResult, usdcPriceResult] = await Promise.allSettled([
    getNativeBalance(normalizedNetwork, address),
    getRecentTransactions(normalizedNetwork, address),
    getCoinPrice(settings.priceId),
    settings.usdc || normalizedNetwork === 'solana' ? getCoinPrice('usd-coin') : Promise.resolve(null)
  ]);
  if (rawNative.status === 'rejected') throw rawNative.reason;

  const nativeAmount = rawNative.value.amount;
  const tokenResult = settings.usdc
    ? await getEvmUsdcBalance(normalizedNetwork, address)
    : normalizedNetwork === 'solana'
      ? await getSolanaUsdcBalance(address)
      : null;
  const nativeUsd = nativePriceResult.status === 'fulfilled'
    ? nativeAmount * nativePriceResult.value
    : null;
  const tokenUsd = tokenResult && usdcPriceResult.status === 'fulfilled' && usdcPriceResult.value !== null
    ? tokenResult?.amount * usdcPriceResult.value
    : null;

  return {
    network: normalizedNetwork,
    address,
    native: {
      symbol: settings.symbol,
      amount: nativeAmount,
      usdValue: nativeUsd
    },
    usdc: tokenResult ? {
      symbol: 'USDC',
      amount: tokenResult.amount,
      usdValue: tokenUsd
    } : null,
    transactions: historyResult.status === 'fulfilled' ? historyResult.value : [],
    warnings: [
      ...(nativePriceResult.status === 'rejected' ? [`Native-coin USD price unavailable: ${nativePriceResult.reason.message}`] : []),
      ...(tokenResult && usdcPriceResult.status === 'rejected' ? [`USDC USD price unavailable: ${usdcPriceResult.reason.message}`] : []),
      ...(historyResult.status === 'rejected' ? [`Transaction history unavailable: ${historyResult.reason.message}`] : [])
    ]
  };
}

async function getNativeBalance(network, address) {
  if (network === 'bitcoin' || network === 'litecoin') {
    const body = await requestJson(`${networkSettings[network].api}/address/${encodeURIComponent(address)}`);
    const confirmed = body.chain_stats.funded_txo_sum - body.chain_stats.spent_txo_sum;
    return { amount: confirmed / 100_000_000 };
  }
  if (network === 'solana') {
    const result = await solanaRpc('getBalance', [address, { commitment: 'confirmed' }]);
    return { amount: Number(result.value) / 1_000_000_000 };
  }

  const { rpcUrl } = getNetwork(network);
  const result = await evmRpc(rpcUrl, 'eth_getBalance', [address, 'latest']);
  return { amount: formatUnits(BigInt(result), 18) };
}

async function getEvmUsdcBalance(network, address) {
  const { rpcUrl } = getNetwork(network);
  const contract = networkSettings[network].usdc;
  const data = `0x70a08231000000000000000000000000${address.slice(2).toLowerCase()}`;
  const raw = await evmRpc(rpcUrl, 'eth_call', [{ to: contract, data }, 'latest']);
  return { amount: formatUnits(BigInt(raw), 6) };
}

async function getSolanaUsdcBalance(address) {
  const result = await solanaRpc('getTokenAccountsByOwner', [
    address,
    { mint: networkSettings.solana.usdcMint },
    { encoding: 'jsonParsed', commitment: 'confirmed' }
  ]);
  const raw = result.value.reduce((sum, account) => {
    const amount = account.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (!/^\d+$/.test(amount || '')) throw new Error('Solana returned an invalid USDC token balance.');
    return sum + BigInt(amount);
  }, 0n);
  return { amount: formatUnits(raw, 6) };
}

async function getRecentTransactions(network, address) {
  if (network === 'bitcoin' || network === 'litecoin') {
    const transactions = await requestJson(`${networkSettings[network].api}/address/${encodeURIComponent(address)}/txs`);
    return transactions.slice(0, 20).map((transaction) => ({
      hash: transaction.txid,
      status: transaction.status?.confirmed ? `block ${transaction.status.block_height}` : 'unconfirmed'
    }));
  }
  if (network === 'solana') {
    const result = await solanaRpc('getSignaturesForAddress', [address, { limit: 20, commitment: 'confirmed' }]);
    return result.map((transaction) => ({
      hash: transaction.signature,
      status: transaction.err ? 'failed' : transaction.slot ? `slot ${transaction.slot}` : 'confirmed'
    }));
  }
  return getEvmRecentTransactions(network, address);
}

async function getEvmRecentTransactions(network, address) {
  if (config.explorerApiKey || config.explorerApiUrl) {
    const result = await getWalletHistory(address, network, 20);
    return result.transactions.map((transaction) => ({
      hash: transaction.hash,
      status: transaction.blockNumber ? `block ${transaction.blockNumber}` : 'pending'
    }));
  }

  const url = new URL(networkSettings[network].explorer);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'txlist');
  url.searchParams.set('address', address);
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', '20');
  url.searchParams.set('sort', 'desc');
  const body = await requestJson(url);
  if (!Array.isArray(body.result)) {
    if (String(body.result).toLowerCase().includes('no transactions')) return [];
    throw new Error(body.message || 'Public explorer returned an invalid transaction history.');
  }
  return body.result.slice(0, 20).map((transaction) => ({
    hash: transaction.hash,
    status: transaction.blockNumber ? `block ${transaction.blockNumber}` : 'pending'
  }));
}

async function solanaRpc(method, params) {
  const response = await requestJson(networkSettings.solana.rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
  });
  if (response.error) throw new Error(`Solana RPC error: ${response.error.message || 'request failed'}.`);
  if (response.result === undefined) throw new Error('Solana RPC returned no result.');
  return response.result;
}

async function evmRpc(url, method, params) {
  const body = await requestJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
  });
  if (body.error) throw new Error(`Public RPC error: ${body.error.message || 'request failed'}.`);
  if (typeof body.result !== 'string' || !body.result.startsWith('0x')) {
    throw new Error('Public RPC returned an invalid balance result.');
  }
  return body.result;
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
  } catch (error) {
    throw new Error(`Public blockchain provider request failed: ${error instanceof Error ? error.name : 'unknown error'}.`);
  }
  if (!response.ok) throw new Error(`Public blockchain provider returned HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new Error('Public blockchain provider returned invalid JSON.');
  }
}

function formatUnits(value, decimals) {
  if (decimals === 0) return value.toString();
  const text = value.toString().padStart(decimals + 1, '0');
  const whole = text.slice(0, -decimals);
  const fraction = text.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}
