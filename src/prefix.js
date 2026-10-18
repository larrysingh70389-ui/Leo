import QRCode from 'qrcode';
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { config } from './config.js';
import { isUnderageAccount, renderUserCheckReport } from './user-checks.js';
import { askAi, limitDiscordMessage } from './ai.js';
import { calculate } from './calculator.js';
import { getWalletAssets } from './wallet.js';
import { getPublicAddressBalance } from './crypto-balance.js';
import { configureUserWallet, deleteUserWallet, formatWallets, getUserWallets } from './user-wallets.js';
import { createProfileImagePayload } from './user-profile.js';
import { handleLoginTimeCommand } from './login-time.js';
import { publicErrorMessage } from './error-message.js';
import { handleEmbedCommand } from './custom-embeds.js';
import { handleTicketPanelCommand } from './tickets.js';
import {
  convertAmount,
  explorerLink,
  getAsset,
  getCoinPrice,
  getReceiptStatus,
  getTokenInfo,
  getTransaction,
  getWalletHistory
} from './public-apis.js';

export const PREFIX = '+';

const paidDeliveryMessage = '**your reward has been delivered please check and vouch me in https://discord.com/channels/1536742466525593722/1545802752783941674**';
const paidReplyUsage = 'Reply to the payment proof message, then use +paidticket <amount> @user.';
const sayAllowedUserIds = new Set(config.authorizedUserIds);
const sayFooter = '                                           -# Sent by leonidas';
const paidTicketOperations = new Map();

function tokenizePrefixText(text) {
  return text.match(/"[^"]*"|'[^']*'|<@!??\d+>|<@&\d+>|\S+/g)?.map((token) => token.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean) ?? [];
}

export function parsePrefixCommand(message) {
  if (!message || message.author?.bot) return null;
  const content = String(message.content || '').trim();
  if (!content.startsWith(PREFIX)) return null;
  const body = content.slice(PREFIX.length).trim();
  if (!body) return null;
  const tokens = tokenizePrefixText(body);
  const name = String(message.commandName || tokens.shift() || '').toLowerCase();
  const args = Array.isArray(message.prefixArgs) ? [...message.prefixArgs] : tokens;
  return { name, args, raw: body };
}

function resolveMentionedUser(message, token) {
  if (!token) return null;
  const match = token.match(/^<@!?(\d+)>$/);
  if (!match) return null;
  return message.mentions?.users?.get(match[1]) || null;
}

function logPaidActionFailure(commandName, action, error) {
  const errorCode = error && typeof error === 'object' && 'code' in error ? ` (code ${error.code})` : '';
  console.error(`+${commandName} could not ${action}${errorCode}.`);
}

function requirePaidStaff(message) {
  const roles = message.member?.roles;
  const hasStaffRole = roles?.cache?.has
    ? roles.cache.has(config.paidStaffRoleId)
    : Array.isArray(roles) && roles.includes(config.paidStaffRoleId);
  if (!message.guild || !hasStaffRole) {
    throw new Error('This command is only available to authorized staff.');
  }
}

function getMessageAttachments(message) {
  return message?.attachments?.values
    ? [...message.attachments.values()]
    : Array.isArray(message?.attachments) ? message.attachments : [];
}

function getAttachmentFiles(message) {
  return getMessageAttachments(message)
    .filter((attachment) => attachment?.url)
    .map((attachment) => ({
      attachment: attachment.url,
      name: attachment.name || 'payment-proof'
    }));
}

function requireProofChannelPermissions(channel, client) {
  const permissions = channel.permissionsFor?.(client.user);
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AttachFiles
  ];
  if (!permissions || required.some((permission) => !permissions.has(permission))) {
    throw new Error('The bot cannot access or send payment proofs in the configured channel.');
  }
}

async function handlePaidTicketWorkflow(message, amount, user, proofMessage, slashAttachments = []) {
  const operationKey = proofMessage?.id || `slash:${message.interactionId}`;
  let operation = paidTicketOperations.get(operationKey);
  if (!operation) {
    operation = { state: {}, running: null };
    paidTicketOperations.set(operationKey, operation);
  }
  if (operation.running) {
    await operation.running;
    return;
  }

  operation.running = (async () => {
    const state = operation.state;
    const failures = [];
    const targetGuild = await message.client.guilds.fetch(config.paidConfirmationGuildId);
    if (targetGuild?.id && targetGuild.id !== config.paidConfirmationGuildId) {
      throw new Error('The configured payment proofs server is unavailable.');
    }
    const proofsChannel = await targetGuild.channels.fetch(config.paidConfirmationChannelId);
    if (!proofsChannel || typeof proofsChannel.send !== 'function') {
      throw new Error('The configured payment proofs channel is unavailable or not text-based.');
    }
    if (proofsChannel.id && proofsChannel.id !== config.paidConfirmationChannelId) {
      throw new Error('The configured payment proofs channel is unavailable or not text-based.');
    }
    requireProofChannelPermissions(proofsChannel, message.client);

    if (proofMessage) {
      if (!state.forwarded) {
        try {
          if (typeof proofMessage.forward !== 'function') {
            throw new Error('Native message forwarding is unavailable.');
          }
          const forwardedMessage = await proofMessage.forward(proofsChannel);
          state.forwardedMessageId = forwardedMessage?.id;
          state.forwarded = true;
        } catch (error) {
          logPaidActionFailure('paidticket', 'forward the payment proof', error);
          failures.push('Could not forward the payment proof.');
        }
      }
      if (state.forwarded && !state.summary) {
        try {
          await proofsChannel.send({
            content: `**Paid ${amount} to <@${user.id}>**`,
            allowedMentions: { users: [user.id] },
            ...(state.forwardedMessageId ? { reply: { messageReference: state.forwardedMessageId } } : {})
          });
          state.summary = true;
        } catch (error) {
          logPaidActionFailure('paidticket', 'send the payment summary', error);
          failures.push('Could not send the payment summary to the configured channel.');
        }
      }
    } else if (!state.forwarded) {
      try {
        await proofsChannel.send({
          content: `**Paid ${amount} to <@${user.id}>**`,
          files: slashAttachments,
          allowedMentions: { users: [user.id] }
        });
        state.forwarded = true;
        state.summary = true;
      } catch (error) {
        logPaidActionFailure('paidticket', 'send the payment confirmation', error);
        failures.push('Could not send the payment confirmation to the configured channel.');
      }
    }

    if (!state.renamed) {
      if (message.channel?.name === 'paid') {
        state.renamed = true;
      } else {
        try {
          if (typeof message.channel?.setName !== 'function') throw new Error('Channel cannot be renamed.');
          await message.channel.setName('paid');
          state.renamed = true;
        } catch (error) {
          logPaidActionFailure('paidticket', 'rename the ticket channel', error);
          failures.push('Could not rename this ticket channel.');
        }
      }
    }

    if (!state.delivered) {
      try {
        await message.channel.send({
          content: paidDeliveryMessage,
          files: proofMessage ? getAttachmentFiles(proofMessage) : slashAttachments,
          allowedMentions: { parse: [] }
        });
        state.delivered = true;
      } catch (error) {
        logPaidActionFailure('paidticket', 'send the ticket delivery message', error);
        failures.push('Could not send the delivery message in this ticket.');
      }
    }

    if (failures.length) {
      await message.reply(`⚠️ Payment processing finished with issues:\n${failures.map((failure) => `- ${failure}`).join('\n')}`).catch((error) => {
        logPaidActionFailure('paidticket', 'report partial failures in the ticket', error);
      });
    }
  })();

  try {
    await operation.running;
  } finally {
    operation.running = null;
  }
}

async function sendInContext(message, payload) {
  if (typeof message.channel?.send === 'function') return message.channel.send(payload);
  if (typeof message.sendInContext === 'function') return message.sendInContext(payload);
  throw new Error('Discord does not provide a sendable channel in this context.');
}

function requireServerAdministrator(message) {
  const permissions = message.memberPermissions ?? message.member?.permissions;
  if (!message.guild || !permissions?.has(PermissionFlagsBits.Administrator)) {
    throw new Error('Administrator permission in a server is required.');
  }
}

function createPrefixLogInteraction(message, action, resetAll) {
  return {
    user: message.author,
    guild: message.guild,
    memberPermissions: message.memberPermissions ?? message.member?.permissions,
    commandName: 'log',
    deferred: false,
    replied: false,
    options: {
      getSubcommand: () => action,
      getBoolean: (name) => name === 'all' && resetAll
    },
    reply: async (payload) => message.reply(payload),
    editReply: async (payload) => message.reply(payload)
  };
}

function publicBalanceEmbed(balance) {
  const usd = (value) => value === null ? 'Unavailable' : `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const fields = [{
    name: balance.native.symbol,
    value: `${balance.native.amount} ${balance.native.symbol} · ${usd(balance.native.usdValue)}`,
    inline: true
  }];
  if (balance.usdc) {
    fields.push({
      name: 'USDC',
      value: `${balance.usdc.amount} USDC · ${usd(balance.usdc.usdValue)}`,
      inline: true
    });
  }
  const transactions = balance.transactions.length
    ? balance.transactions.map(({ hash, status }) => `\`${hash.slice(0, 14)}…\` ${status}`).join('\n')
    : 'No recent transactions found.';
  const embed = new EmbedBuilder()
    .setTitle(`Public address on ${balance.network}`)
    .setDescription(`\`${balance.address}\`\n\n**Recent transactions (up to 20)**\n${transactions}`)
    .addFields(fields)
    .setColor(0x5865f2);
  if (balance.warnings.length) embed.setFooter({ text: balance.warnings.join(' · ').slice(0, 2048) });
  return { embeds: [embed] };
}

async function handleBalanceCommand(network, address, send) {
  if (!network || !address) throw new Error('Provide both a supported network and a public address.');
  const balance = await getPublicAddressBalance(network, address);
  await send(publicBalanceEmbed(balance));
}

async function handleProfileImage(client, userId, kind, send) {
  const payload = await createProfileImagePayload(client, userId, kind);
  await send(payload);
}

export async function handlePrefixCommand(message) {
  const parsed = parsePrefixCommand(message);
  if (!parsed) return false;

  const { name, args } = parsed;
  if (!name) return false;

  if (name === 'help') {
    await message.reply('**Commands**\nUse slash commands or their `+` prefix equivalents. Examples: `/ask`, `/say`, `/avatar`, `/banner`, `/setup wallet`, `/wallets`, `/balance`, `/price`, `/log`, `/serverinfo`, and `+` followed by the same command name. Economy and gambling commands have been removed.');
    return true;
  }

  try {
    if (name === 'log') {
      const action = args[0]?.toLowerCase();
      if (!['in', 'out', 'time', 'leaderboard', 'reset'].includes(action)) {
        throw new Error('Usage: +log <in|out|time|leaderboard|reset [all]>.');
      }
      await handleLoginTimeCommand(createPrefixLogInteraction(message, action, action === 'reset' && args[1]?.toLowerCase() === 'all'));
      return true;
    }

    if (name === 'setup') {
      if (args[0]?.toLowerCase() !== 'wallet') throw new Error('Usage: +setup wallet <set|remove> <asset> <network> [address].');
      const action = args[1]?.toLowerCase();
      const asset = args[2];
      const network = args[3];
      if (action === 'set') {
        const address = args[4];
        if (!asset || !network || !address) throw new Error('Usage: +setup wallet set <asset> <network> <public-address>.');
        const result = await configureUserWallet(message.author.id, asset, network, address);
        await message.reply(`✅ Saved your public ${result.asset.toUpperCase()} address on ${result.network}.`);
        return true;
      }
      if (action === 'remove') {
        if (!asset || !network) throw new Error('Usage: +setup wallet remove <asset> <network>.');
        const removed = deleteUserWallet(message.author.id, asset, network);
        await message.reply(removed ? `✅ Removed your ${asset.toUpperCase()} address on ${network}.` : 'No matching configured wallet address was found.');
        return true;
      }
      throw new Error('Usage: +setup wallet <set|remove> <asset> <network> [address].');
    }

    if (name === 'wallets') {
      const target = resolveMentionedUser(message, args[0]) || message.author;
      await message.reply(`**Public wallets for ${target}**\n${formatWallets(getUserWallets(target.id))}`);
      return true;
    }

    if (name === 'balance') {
      await handleBalanceCommand(args[0], args[1], (payload) => message.reply(payload));
      return true;
    }

    if (name === 'avatar' || name === 'banner') {
      const target = resolveMentionedUser(message, args[0]) || message.author;
      await handleProfileImage(message.client, target.id, name, (payload) => message.reply(payload));
      return true;
    }

    if (name === 'paid' || name === 'paidticket') {
      const usage = `Usage: +${name} <amount> @user`;
      const amount = args[0];
      if (!amount || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(amount) || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
        throw new Error(`Enter a valid positive amount. ${usage}`);
      }
      const user = resolveMentionedUser(message, args[1]);
      if (!user) throw new Error(`Mention one Discord user. ${usage}`);
      requirePaidStaff(message);
      let proofMessage = null;
      if (!message.isPaidSlashCommand) {
        if (!message.reference?.messageId || typeof message.fetchReference !== 'function') {
          throw new Error(paidReplyUsage);
        }
        try {
          proofMessage = await message.fetchReference();
        } catch {
          throw new Error(paidReplyUsage);
        }
        if (!proofMessage) throw new Error(paidReplyUsage);
      } else if (!getAttachmentFiles(message).length) {
        throw new Error(`Attach a payment screenshot. ${usage}`);
      }
      await handlePaidTicketWorkflow(message, amount, user, proofMessage, message.isPaidSlashCommand ? getAttachmentFiles(message) : []);
      return true;
    }

    if (name === 'check') {
      if (!message.guild) throw new Error('This command can only be used in a server.');
      if (args[0]?.toLowerCase() !== 'users') throw new Error('Usage: +check users @user [@user ...]');
      const mentionedUsers = [...new Map(args.slice(1)
        .map((token) => resolveMentionedUser(message, token))
        .filter(Boolean)
        .map((user) => [user.id, user])).values()];
      if (!mentionedUsers.length) throw new Error('Usage: +check users @user [@user ...]');
      const report = await renderUserCheckReport(message.client, mentionedUsers);
      await message.reply(report);
      return true;
    }

    if (name === 'say') {
      const text = args.join(' ');
      if (!text.trim()) throw new Error('Usage: +say <message>.');
      const isAllowedUser = sayAllowedUserIds.has(message.author.id);
      const isAdmin = message.memberPermissions?.has(PermissionFlagsBits.Administrator) || message.member?.permissions?.has(PermissionFlagsBits.Administrator);
      if (!isAllowedUser && !isAdmin) {
        throw new Error('You are not authorized to use +say.');
      }
      if (message.channel?.send && typeof message.channel.send === 'function') {
        await message.channel.send(`${text}${sayFooter}`);
        return true;
      }
      throw new Error('This command requires a channel with message sending enabled.');
    }

    if (name === 'everyone' || name === 'here') {
      const text = args.join(' ');
      if (!text.trim()) throw new Error(`Usage: +${name} <message>.`);
      requireServerAdministrator(message);
      const mention = name === 'everyone' ? '@everyone' : '@here';
      await sendInContext(message, { content: `${mention} ${text}`, allowedMentions: { parse: [name] } });
      await message.reply('Mention sent.');
      return true;
    }

    if (name === 'ask' || name === 'summarize') {
      const prompt = args.join(' ');
      if (!prompt.trim()) throw new Error(`Usage: +${name} <question>.`);
      const result = await askAi(name === 'summarize' ? `Summarize the following text in plain language:\n\n${prompt}` : prompt);
      await message.reply(limitDiscordMessage(result));
      return true;
    }

    if (name === 'calc') {
      const expression = args.join(' ');
      if (!expression.trim()) throw new Error('Usage: +calc <expression>.');
      const result = await calculate(expression);
      await message.reply(`Result: \`${result}\``);
      return true;
    }

    if (name === 'wallet' || name === 'address' || name === 'addresses') {
      const assets = getWalletAssets();
      if (name === 'wallet') {
        const wallet = assets.find((entry) => entry.address) || null;
        if (!wallet) throw new Error('No bot-configured wallet addresses are available.');
        await message.reply(`**Wallet**\n${wallet.address}`);
        return true;
      }
      if (name === 'address') {
        const coin = args[0]?.toLowerCase();
        const network = args[1]?.toLowerCase();
        const asset = getAsset(coin || '', network || '');
        if (!asset) throw new Error('Usage: +address <coin> <network>.');
        await message.reply(`**${coin.toUpperCase()} / ${network}**\n${asset.address}`);
        return true;
      }
      await message.reply(`**Configured public addresses**\n${assets.map((asset) => `**${asset.coin.toUpperCase()} / ${asset.network}**\n${asset.address}`).join('\n\n') || 'None configured.'}`);
      return true;
    }

    if (name === 'price') {
      const coin = args[0];
      const currency = args[1] || 'usd';
      if (!coin) throw new Error('Usage: +price <coin> [currency].');
      const price = await getCoinPrice(coin, currency);
      await message.reply(`**${coin.toUpperCase()}**: ${price} ${currency.toUpperCase()}`);
      return true;
    }

    if (name === 'tokenprice') {
      const token = args[0];
      const currency = args[1] || 'usd';
      if (!token) throw new Error('Usage: +tokenprice <token> [currency].');
      const info = await getTokenInfo(token);
      if (!info.price) throw new Error(`No ${currency.toUpperCase()} price is available for ${token}.`);
      await message.reply(`**${token.toUpperCase()}**: ${info.price} ${currency.toUpperCase()}`);
      return true;
    }

    if (name === 'tokeninfo') {
      const token = args.join(' ');
      if (!token) throw new Error('Usage: +tokeninfo <token>.');
      const info = await getTokenInfo(token);
      await message.reply(`**${info.name || token}**\nSymbol: ${info.symbol || 'Unknown'}\nPrice: ${info.price ?? 'Unavailable'} USD\nMarket cap: ${info.marketCap ?? 'Unavailable'}\nWebsite: ${info.website || 'Unavailable'}`);
      return true;
    }

    if (name === 'qr') {
      const content = args.join(' ');
      if (!content) throw new Error('Usage: +qr <content>.');
      const dataUrl = await QRCode.toDataURL(content, { margin: 1, width: 256 });
      await message.reply({ files: [{ attachment: dataUrl, name: 'qr-code.png' }] });
      return true;
    }

    if (name === 'convert') {
      const amount = Number(args[0]);
      const from = args[1];
      const to = args[2];
      if (!Number.isFinite(amount) || !from || !to) throw new Error('Usage: +convert <amount> <from> <to>.');
      const result = await convertAmount(amount, from, to);
      await message.reply(`**${amount} ${from.toUpperCase()} = ${result.result.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${to.toUpperCase()}**`);
      return true;
    }

    if (name === 'txid') {
      const hash = args[0];
      const network = args[1];
      if (!hash || !network) throw new Error('Usage: +txid <hash> <network>.');
      const transaction = await getTransaction(hash, network);
      await message.reply(`**Transaction on ${network}**\n${JSON.stringify(transaction, null, 2).slice(0, 1800)}`);
      return true;
    }

    if (name === 'ticketpaid') {
      const hash = args[0];
      const network = args[1];
      if (!hash || !network) throw new Error('Usage: +ticketpaid <txid> <network>');
      const status = await getReceiptStatus(hash, network);
      await message.reply(`**Transaction status**: ${status}`);
      return true;
    }

    if (name === 'wallethistory') {
      const network = args[0];
      const address = args[1] || getWalletAssets().find((asset) => asset.network?.toLowerCase() === network?.toLowerCase())?.address;
      if (!network || !address) throw new Error('Usage: +wallethistory <network> [address].');
      const history = await getWalletHistory(address, network, 5);
      await message.reply(`**Wallet history on ${network}**\n${history.transactions.map((txn) => `\`${txn.hash.slice(0, 16)}…\` ${txn.status}`).join('\n') || 'No recent transactions.'}`);
      return true;
    }

    if (name === 'explorer') {
      const type = args[0];
      const value = args[1];
      const network = args[2];
      if (!type || !value || !network) throw new Error('Usage: +explorer <address|tx> <value> <network>.');
      const link = explorerLink(type, value, network);
      await message.reply(link);
      return true;
    }

    if (name === 'payinfo') {
      const coin = args[0];
      const network = args[1];
      if (!coin || !network) throw new Error('Usage: +payinfo <coin> <network>.');
      const asset = getAsset(coin, network);
      if (!asset) throw new Error(`No configured public payment address exists for ${coin.toUpperCase()} on ${network}.`);
      await message.reply(`**${coin.toUpperCase()} / ${network}**\n${asset.address}\n\n${config.paymentInstructions || 'No payment instructions configured.'}`);
      return true;
    }

    if (name === 'reward') {
      await message.reply(config.rewardMessage);
      return true;
    }

    if (name === 'vouch') {
      const user = resolveMentionedUser(message, args[0]) || message.mentions?.users?.first();
      const vouchText = args.slice(1).join(' ');
      if (!user || !vouchText) throw new Error('Usage: +vouch @user <message>');
      await message.reply(`**Vouch** for ${user}: ${vouchText}\n_vouched by ${message.author}_`);
      return true;
    }

    if (name === 'serverinfo') {
      if (!message.guild) {
        await message.reply('This command can only be used in a server.');
        return true;
      }
      await message.reply(`**${message.guild.name}**\nOwner: <@${message.guild.ownerId}>\nMembers: ${message.guild.memberCount}\nChannels: ${message.guild.channels.cache.size}\nCreated: ${message.guild.createdAt.toISOString()}`);
      return true;
    }

    await message.reply(`Unknown command: +${name}. Try +help for a list of commands.`);
    return true;
  } catch (error) {
    console.error(`Error handling prefix command +${name}:`, error instanceof Error ? error.name : 'unknown error');
    await message.reply(`❌ ${publicErrorMessage(error)}`);
    return true;
  }
}

export async function handleSlashCommand(interaction) {
  if (interaction.commandName === 'ticketpanel') return handleTicketPanelCommand(interaction);
  if (interaction.commandName === 'embed') return handleEmbedCommand(interaction);

  if (interaction.commandName === 'ask' && !interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }

  if (interaction.commandName === 'setup') {
    if (interaction.options.getSubcommandGroup() !== 'wallet') throw new Error('Unknown setup group.');
    const action = interaction.options.getSubcommand();
    const asset = interaction.options.getString('asset', true);
    const network = interaction.options.getString('network', true);
    if (action === 'set') {
      const address = interaction.options.getString('address', true);
      const result = await configureUserWallet(interaction.user.id, asset, network, address);
      await interaction.editReply(`✅ Saved your public ${result.asset.toUpperCase()} address on ${result.network}.`);
      return true;
    }
    if (action === 'remove') {
      const removed = deleteUserWallet(interaction.user.id, asset, network);
      await interaction.editReply(removed ? `✅ Removed your ${asset.toUpperCase()} address on ${network}.` : 'No matching configured wallet address was found.');
      return true;
    }
    throw new Error(`Unknown wallet setup action: ${action}.`);
  }

  if (interaction.commandName === 'wallets') {
    const target = interaction.options.getUser('user') || interaction.user;
    await interaction.editReply(`**Public wallets for ${target}**\n${formatWallets(getUserWallets(target.id))}`);
    return true;
  }

  if (interaction.commandName === 'balance') {
    await handleBalanceCommand(
      interaction.options.getString('network', true),
      interaction.options.getString('address', true),
      (payload) => interaction.editReply(payload)
    );
    return true;
  }

  if (interaction.commandName === 'avatar' || interaction.commandName === 'banner') {
    const target = interaction.options.getUser('user') || interaction.user;
    await handleProfileImage(
      interaction.client,
      target.id,
      interaction.commandName,
      (payload) => interaction.editReply(payload)
    );
    return true;
  }

  if (interaction.commandName === 'paidticket') {
    const amount = interaction.options.getNumber('amount');
    const user = interaction.options.getUser('user');
    const screenshot = interaction.options.getAttachment('screenshot');
    const mentionUsers = new Map(user ? [[user.id, user]] : []);
    const attachmentMap = new Map(screenshot ? [['payment-screenshot', screenshot]] : []);
    let responseHandled = false;

    const handled = await handlePrefixCommand({
      author: interaction.user,
      commandName: 'paidticket',
      content: `${PREFIX}paidticket`,
      prefixArgs: [amount === null ? '' : String(amount), user ? `<@${user.id}>` : ''],
      mentions: { users: { get: (userId) => mentionUsers.get(userId) || null } },
      attachments: attachmentMap,
      member: interaction.member,
      isPaidSlashCommand: true,
      interactionId: interaction.id,
      guild: interaction.guild,
      channel: interaction.channel,
      client: interaction.client,
      reply: async (payload) => {
        responseHandled = true;
        return interaction.deferred || interaction.replied
          ? interaction.editReply(payload)
          : interaction.reply(payload);
      }
    });

    if (!responseHandled && interaction.deferred) await interaction.deleteReply();
    return handled;
  }

  if (interaction.commandName === 'check') {
    if (interaction.options.getSubcommand() !== 'users') {
      throw new Error('Unknown check subcommand.');
    }

    const mentionUsers = new Map();
    const prefixArgs = ['users'];
    for (let index = 1; index <= 10; index += 1) {
      const user = interaction.options.getUser(`user${index}`);
      if (!user) continue;
      mentionUsers.set(user.id, user);
      prefixArgs.push(`<@${user.id}>`);
    }

    return handlePrefixCommand({
      author: interaction.user,
      commandName: 'check',
      content: `${PREFIX}check`,
      prefixArgs,
      mentions: { users: { get: (userId) => mentionUsers.get(userId) || null } },
      guild: interaction.guild,
      channel: interaction.channel,
      client: interaction.client,
      reply: async (payload) => interaction.deferred || interaction.replied
        ? interaction.editReply(payload)
        : interaction.reply(payload)
    });
  }

  const mentionUsers = new Map();
  const prefixArgs = interaction.options.data.map((option) => {
    if (option.user) {
      mentionUsers.set(option.user.id, option.user);
      return `<@${option.user.id}>`;
    }
    if (option.attachment) return 'attachment';
    if (option.value !== undefined) return String(option.value);
    return '';
  }).filter((token) => token !== '');

  return handlePrefixCommand({
    author: interaction.user,
    commandName: interaction.commandName,
    content: `${PREFIX}${interaction.commandName}`,
    prefixArgs,
    mentions: { users: { get: (userId) => mentionUsers.get(userId) || null } },
    guild: interaction.guild,
    channel: interaction.channel,
    client: interaction.client,
    memberPermissions: interaction.memberPermissions,
    reply: async (payload) => interaction.deferred || interaction.replied
      ? interaction.editReply(payload)
      : interaction.reply(payload)
  });
}
