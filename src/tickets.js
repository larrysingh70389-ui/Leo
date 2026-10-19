import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} from 'discord.js';
import { config } from './config.js';
import { hasTicketStaffRole, isAdministrator, isAuthorizedUser } from './command-permissions.js';
import { parseHttpsImageUrl } from './ticket-validation.js';

const ticketTypes = {
  support: {
    title: '❓ Server Issues',
    description: 'General server-related help and inquiries.',
    button: 'Contact support',
    channelPrefix: 'support',
    welcome: 'A member of the support team will respond shortly.'
  },
  appeal: {
    title: '🛡️ Appeals',
    description: 'Dispute a moderation action against you.',
    button: 'Submit appeal',
    channelPrefix: 'appeal',
    welcome: 'The moderation team will review your appeal and respond shortly.'
  },
  report: {
    title: '⚠️ Report',
    description: 'Report suspicious or scam activity.',
    button: 'Report scam',
    channelPrefix: 'report',
    welcome: 'The support team will review your report and respond shortly.'
  }
};
const openingTickets = new Set();

function getTicketPanelPayload() {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('Support Hub')
    .setDescription('Need help? Open a ticket with one of the options below!')
    .addFields(
      { name: ticketTypes.support.title, value: ticketTypes.support.description, inline: false },
      { name: '\u200b', value: '────────────────────────', inline: false },
      { name: ticketTypes.appeal.title, value: ticketTypes.appeal.description, inline: false },
      { name: '\u200b', value: '────────────────────────', inline: false },
      { name: ticketTypes.report.title, value: ticketTypes.report.description, inline: false }
    );
  if (config.ticketPanelBannerUrl) {
    try {
      embed.setImage(parseHttpsImageUrl(config.ticketPanelBannerUrl, 'ticket panel banner URL'));
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('The ticket panel banner URL')) throw error;
      console.warn(`${error.message} The panel will be posted without a banner.`);
    }
  }

  const row = new ActionRowBuilder().addComponents(
    ...Object.entries(ticketTypes).map(([type, ticket]) => new ButtonBuilder()
      .setCustomId(`ticket:open:${type}`)
      .setLabel(ticket.button)
      .setStyle(ButtonStyle.Primary))
  );
  return { embeds: [embed], components: [row] };
}

function hasPanelPermission(interaction) {
  return isAdministrator(interaction) || isAuthorizedUser(interaction) || hasTicketStaffRole(interaction);
}

export async function handleTicketPanelCommand(interaction) {
  if (!interaction.guild || !interaction.channel || typeof interaction.channel.send !== 'function') {
    throw new Error('Post the ticket panel from a server text channel.');
  }
  if (!hasPanelPermission(interaction)) {
    throw new Error('You are not authorized to post the ticket panel.');
  }
  if (!config.ticketCategoryId) {
    throw new Error('Ticket creation is not configured. Set TICKET_CATEGORY_ID before posting the panel.');
  }
  if (!config.ticketSupportRoleIds.length) {
    throw new Error('Ticket staff is not configured. Set TICKET_SUPPORT_ROLE_IDS before posting the panel.');
  }
  await interaction.channel.send(getTicketPanelPayload());
  await interaction.editReply('✅ Support ticket panel posted.');
  return true;
}

function makeChannelName(prefix, username) {
  const slug = String(username || 'member')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'member';
  return `${prefix}-${slug}`.slice(0, 100);
}

function findOpenTicket(guild, ownerId, type) {
  return guild.channels.cache.find((channel) =>
    channel.parentId === config.ticketCategoryId
    && channel.topic?.includes(`ticket-owner:${ownerId};ticket-type:${type}`)
  );
}

async function openTicket(interaction, type) {
  const ticketType = ticketTypes[type];
  if (!ticketType) throw new Error('This ticket option is no longer available.');
  if (!config.ticketCategoryId) throw new Error('Ticket creation is not configured. Set TICKET_CATEGORY_ID first.');
  if (!config.ticketSupportRoleIds.length) {
    throw new Error('Ticket staff is not configured. Set TICKET_SUPPORT_ROLE_IDS first.');
  }
  const category = await interaction.guild.channels.fetch(config.ticketCategoryId);
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error('TICKET_CATEGORY_ID must refer to a category in this server.');
  }
  if (category.guildId && category.guildId !== interaction.guild.id) {
    throw new Error('The configured ticket category belongs to a different server.');
  }

  const duplicate = findOpenTicket(interaction.guild, interaction.user.id, type);
  if (duplicate) {
    await interaction.editReply(`You already have an open ${type} ticket: <#${duplicate.id}>.`);
    return true;
  }

  const lockKey = `${interaction.guild.id}:${interaction.user.id}:${type}`;
  if (openingTickets.has(lockKey)) {
    await interaction.editReply('Your ticket is already being created. Please wait a moment.');
    return true;
  }
  openingTickets.add(lockKey);
  try {
    const botId = interaction.client.user.id;
    const overwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      },
      {
        id: botId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.EmbedLinks
        ]
      },
      ...config.ticketSupportRoleIds.map((roleId) => ({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      }))
    ];
    const channel = await interaction.guild.channels.create({
      name: makeChannelName(ticketType.channelPrefix, interaction.user.username),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `ticket-owner:${interaction.user.id};ticket-type:${type}`,
      permissionOverwrites: overwrites
    });
    const welcome = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(ticketType.title)
      .setDescription(`Welcome <@${interaction.user.id}>. ${ticketType.welcome}`)
      .setFooter({ text: 'Please provide the details needed to help you.' });
    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:close:${channel.id}`)
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger)
    );
    await channel.send({
      embeds: [welcome],
      components: [closeRow],
      allowedMentions: { users: [interaction.user.id] }
    });
    await interaction.editReply(`✅ Your ${type} ticket is ready: <#${channel.id}>.`);
    return true;
  } finally {
    openingTickets.delete(lockKey);
  }
}

export async function handleTicketButton(interaction) {
  if (!interaction.guild) {
    await interaction.reply({ content: 'Tickets can only be used in a server.', ephemeral: true });
    return true;
  }
  await interaction.deferReply({ ephemeral: true });
  const [namespace, action, value] = interaction.customId.split(':');
  if (namespace !== 'ticket') return false;
  if (action === 'open') return openTicket(interaction, value);
  if (action !== 'close') throw new Error('This ticket action is not supported.');

  const channel = interaction.channel;
  const isOwner = channel?.topic?.includes(`ticket-owner:${interaction.user.id};`);
  if (!isOwner && !isAdministrator(interaction) && !isAuthorizedUser(interaction) && !hasTicketStaffRole(interaction)) {
    throw new Error('Only the ticket opener or authorized staff can close this ticket.');
  }
  if (!channel || channel.id !== value || channel.type !== ChannelType.GuildText) {
    throw new Error('This close button is not attached to its ticket channel.');
  }
  await channel.delete(`Ticket closed by ${interaction.user.tag || interaction.user.id}`);
  await interaction.editReply('✅ Ticket closed.');
  return true;
}
