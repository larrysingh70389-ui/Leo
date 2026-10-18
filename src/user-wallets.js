import { getWalletAddresses, removeWalletAddress, setWalletAddress } from './database.js';
import { isSupportedBalanceNetwork, verifyPublicAddress } from './crypto-balance.js';

const supportedAssets = new Set(['bitcoin', 'litecoin', 'solana', 'ethereum', 'usdc']);

export function getUserWallets(userId) {
  return getWalletAddresses(userId);
}

export async function configureUserWallet(userId, asset, network, address) {
  const normalizedAsset = String(asset).toLowerCase();
  const normalizedNetwork = String(network).toLowerCase();
  if (!supportedAssets.has(normalizedAsset)) throw new Error(`Unsupported wallet asset: ${asset}.`);
  if (!isSupportedBalanceNetwork(normalizedNetwork)) throw new Error(`Unsupported wallet network: ${network}.`);
  await verifyPublicAddress(normalizedNetwork, address, normalizedAsset);
  setWalletAddress(userId, normalizedAsset, normalizedNetwork, address);
  return { asset: normalizedAsset, network: normalizedNetwork };
}

export function deleteUserWallet(userId, asset, network) {
  const normalizedAsset = String(asset).toLowerCase();
  const normalizedNetwork = String(network).toLowerCase();
  if (!supportedAssets.has(normalizedAsset)) throw new Error(`Unsupported wallet asset: ${asset}.`);
  if (!isSupportedBalanceNetwork(normalizedNetwork)) throw new Error(`Unsupported wallet network: ${network}.`);
  return removeWalletAddress(userId, normalizedAsset, normalizedNetwork);
}

export function formatWallets(wallets) {
  return wallets.length
    ? wallets.map(({ asset, network, address }) => `**${asset.toUpperCase()} / ${network}**\n${address}`).join('\n\n')
    : 'No public wallet addresses are configured.';
}
