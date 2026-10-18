import 'dotenv/config';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseWalletAssets() {
  const raw = process.env.WALLET_ASSETS_JSON?.trim();
  if (raw) {
    try {
      const assets = JSON.parse(raw);
      if (!Array.isArray(assets)) throw new Error('WALLET_ASSETS_JSON must be an array.');
      return assets;
    } catch (error) {
      throw new Error(`Invalid WALLET_ASSETS_JSON: ${error.message}`);
    }
  }

  const address = process.env.WALLET_ADDRESS?.trim();
  const network = process.env.WALLET_NETWORK?.trim();
  return address && network
    ? [{
        coin: process.env.WALLET_COIN?.trim() || 'ETH',
        network,
        address,
        priceId: process.env.WALLET_PRICE_ID?.trim() || 'ethereum'
      }]
    : [];
}

function parseIdList(value) {
  return [...new Set((value || '').split(',').map((id) => id.trim()).filter(Boolean))];
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  clientId: process.env.CLIENT_ID?.trim() || '',
  guildId: process.env.GUILD_ID?.trim() || '',
  verifiedRoleId: process.env.VERIFIED_ROLE_ID?.trim() || '1543986189676191744',
  paidStaffRoleId: '1543986346845151233',
  paidConfirmationGuildId: '1536742466525593722',
  paidConfirmationChannelId: '1545802902973452329',
  openAiApiKey: process.env.OPENAI_API_KEY?.trim() || '',
  openAiModel: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
  coingeckoApiKey: process.env.COINGECKO_API_KEY?.trim() || '',
  walletAssets: parseWalletAssets(),
  explorerApiKey: process.env.EXPLORER_API_KEY?.trim() || '',
  explorerApiUrl: process.env.EXPLORER_API_URL?.trim() || '',
  paymentInstructions: process.env.PAYMENT_INSTRUCTIONS?.trim() || '',
  rewardMessage: process.env.REWARD_MESSAGE?.trim() || 'Rewards are informational only. This bot never sends funds.',
  databasePath: process.env.DATABASE_PATH?.trim() || './data/leonidas.sqlite',
  legacyDatabasePath: process.env.ECONOMY_DATABASE_PATH?.trim() || './data/economy.sqlite',
  timezone: process.env.TIMEZONE?.trim() || 'UTC',
  authorizedUserIds: ['1347457775160266804', '1406878282275618826'],
  ticketCategoryId: process.env.TICKET_CATEGORY_ID?.trim() || '',
  ticketSupportRoleIds: parseIdList(process.env.TICKET_SUPPORT_ROLE_IDS),
  ticketPanelBannerUrl: process.env.TICKET_PANEL_BANNER_URL?.trim() || ''
};
