import assert from 'node:assert/strict';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

const { commands } = await import('../src/commands.js');
const { config } = await import('../src/config.js');
const { handleEmbedCommand } = await import('../src/custom-embeds.js');
const { handleTicketPanelCommand, handleTicketButton } = await import('../src/tickets.js');
const { handleSlashCommand } = await import('../src/prefix.js');

const definitions = commands.map((command) => command.toJSON());
const ticketPanelCommand = definitions.find((command) => command.name === 'ticketpanel');
const embedCommand = definitions.find((command) => command.name === 'embed');
assert.ok(ticketPanelCommand);
assert.deepEqual(ticketPanelCommand.contexts, [0]);
assert.ok(embedCommand);
assert.equal(embedCommand.options[0].name, 'channel');
assert.equal(embedCommand.options[0].required, true);
assert.deepEqual(embedCommand.options.slice(1).map((option) => option.name), [
  'title', 'description', 'color', 'image', 'thumbnail', 'footer', 'author', 'content', 'template'
]);

const adminPermissions = { has: (permission) => permission === PermissionFlagsBits.Administrator };
const noPermissions = { has: () => false };
config.ticketCategoryId = '';
const sentPanels = [];
const panelInteraction = {
  guild: { id: 'guild-1' },
  channel: { send: async (payload) => sentPanels.push(payload) },
  memberPermissions: adminPermissions,
  user: { id: 'admin-1' },
  editReply: async (payload) => payload
};
await assert.rejects(handleTicketPanelCommand(panelInteraction), /Set TICKET_CATEGORY_ID/);
config.ticketCategoryId = 'category-1';
await assert.rejects(handleTicketPanelCommand(panelInteraction), /Set TICKET_SUPPORT_ROLE_IDS/);
config.ticketSupportRoleIds = ['staff-role'];
assert.equal(await handleTicketPanelCommand(panelInteraction), true);
assert.equal(sentPanels[0].embeds[0].data.title, 'Support Hub');
assert.match(sentPanels[0].embeds[0].data.description, /Need help\?/);
assert.equal(sentPanels[0].components[0].components.length, 3);
assert.deepEqual(sentPanels[0].components[0].components.map((button) => button.data.custom_id), [
  'ticket:open:support', 'ticket:open:appeal', 'ticket:open:report'
]);
assert.equal(await handleSlashCommand({
  ...panelInteraction,
  commandName: 'ticketpanel'
}), true);
assert.equal(sentPanels.length, 2, 'slash router sends the ticket panel to the current channel');
await assert.rejects(handleTicketPanelCommand({
  ...panelInteraction,
  memberPermissions: noPermissions,
  user: { id: 'unauthorized-user' }
}), /not authorized/);

const guild = {
  id: 'guild-1',
  roles: { everyone: { id: 'everyone-role' }, cache: new Set(['staff-role']) },
  channels: {
    cache: {
      values: [],
      find(predicate) { return this.values.find(predicate); }
    },
    fetch: async (id) => ({ id, type: ChannelType.GuildCategory, guildId: 'guild-1' }),
    create: async (options) => {
      const channel = {
        id: `ticket-${guild.channels.cache.values.length + 1}`,
        type: ChannelType.GuildText,
        guildId: 'guild-1',
        parentId: options.parent,
        topic: options.topic,
        options,
        messages: [],
        send: async (payload) => channel.messages.push(payload),
        delete: async (reason) => { channel.deletedReason = reason; }
      };
      guild.channels.cache.values.push(channel);
      return channel;
    }
  }
};
const ticketReplies = [];
const ticketInteraction = {
  customId: 'ticket:open:support',
  guild,
  user: { id: 'member-1', username: 'Member One', tag: 'Member One#0001' },
  member: { roles: { cache: new Set() } },
  client: { user: { id: 'bot-1' } },
  deferReply: async (payload) => ticketReplies.push(payload),
  editReply: async (payload) => ticketReplies.push(payload)
};
assert.equal(await handleTicketButton(ticketInteraction), true);
assert.deepEqual(ticketReplies[0], { ephemeral: true });
assert.match(ticketReplies[1], /Your support ticket is ready/);
const createdTicket = guild.channels.cache.values[0];
assert.equal(createdTicket.options.name, 'support-member-one');
assert.equal(createdTicket.options.permissionOverwrites[0].id, 'everyone-role');
assert.ok(createdTicket.options.permissionOverwrites[0].deny.includes(PermissionFlagsBits.ViewChannel));
assert.ok(createdTicket.options.permissionOverwrites.some((overwrite) => overwrite.id === 'member-1'));
assert.ok(createdTicket.options.permissionOverwrites.some((overwrite) => overwrite.id === 'staff-role'));
assert.match(createdTicket.messages[0].embeds[0].data.description, /respond shortly/);
assert.equal(createdTicket.messages[0].components[0].components[0].data.custom_id, `ticket:close:${createdTicket.id}`);

const duplicateReplies = [];
assert.equal(await handleTicketButton({
  ...ticketInteraction,
  deferReply: async () => {},
  editReply: async (payload) => duplicateReplies.push(payload)
}), true);
assert.equal(guild.channels.cache.values.length, 1);
assert.match(duplicateReplies[0], /already have an open support ticket/);

const closeReplies = [];
assert.equal(await handleTicketButton({
  ...ticketInteraction,
  customId: `ticket:close:${createdTicket.id}`,
  channel: createdTicket,
  deferReply: async (payload) => closeReplies.push(payload),
  editReply: async (payload) => closeReplies.push(payload)
}), true);
assert.match(createdTicket.deletedReason, /Ticket closed by/);
assert.equal(closeReplies.at(-1), '✅ Ticket closed.');

function embedInteraction({
  userId = config.authorizedUserIds[0],
  permissions = noPermissions,
  values = {},
  destination = { id: 'text-1', type: ChannelType.GuildText, guildId: 'guild-1', send: async (payload) => sentEmbeds.push(payload) },
  replies = []
} = {}) {
  return {
    guild: { id: 'guild-1' },
    memberPermissions: permissions,
    user: { id: userId },
    options: {
      getChannel: () => destination,
      getString: (name) => values[name] ?? null
    },
    editReply: async (payload) => replies.push(payload)
  };
}

const sentEmbeds = [];
const embedReplies = [];
assert.equal(await handleEmbedCommand(embedInteraction({
  values: { title: 'Announcement', description: 'Hello server.', color: '#5865F2', content: 'Please read this.' },
  replies: embedReplies
})), true);
assert.equal(sentEmbeds[0].embeds[0].data.title, 'Announcement');
assert.equal(sentEmbeds[0].embeds[0].data.color, 0x5865f2);
assert.equal(sentEmbeds[0].content, 'Please read this.');
assert.deepEqual(sentEmbeds[0].allowedMentions, { parse: [] });
assert.match(embedReplies[0], /Embed sent/);
const adminEmbedReplies = [];
assert.equal(await handleSlashCommand({
  ...embedInteraction({
    userId: 'server-admin',
    permissions: adminPermissions,
    values: { title: 'Routed embed' },
    replies: adminEmbedReplies
  }),
  commandName: 'embed'
}), true);
assert.equal(sentEmbeds.at(-1).embeds[0].data.title, 'Routed embed');
assert.match(adminEmbedReplies[0], /Embed sent/);

const rulesReplies = [];
assert.equal(await handleEmbedCommand(embedInteraction({
  values: { template: 'server-rules' },
  replies: rulesReplies
})), true);
const rulesEmbed = sentEmbeds.at(-1).embeds[0].data;
assert.equal(rulesEmbed.title, 'The Stock Guidelines');
assert.equal(rulesEmbed.fields.length, 5);
assert.match(rulesEmbed.fields[0].value, /https:\/\/discord\.com\/terms/);
assert.match(rulesEmbed.fields[3].value, /STAFF RESERVE THE RIGHT/);
assert.match(rulesEmbed.fields[4].value, /create an appeal ticket/);

await assert.rejects(handleEmbedCommand(embedInteraction({
  userId: 'not-authorized',
  values: { title: 'Unauthorized' }
})), /not authorized/);
await assert.rejects(handleEmbedCommand(embedInteraction({
  values: { title: 'Invalid color', color: 'blue' }
})), /six-digit hexadecimal/);
await assert.rejects(handleEmbedCommand(embedInteraction({
  values: { title: 'Invalid URL', image: 'javascript:alert(1)' }
})), /valid HTTPS URL/);
await assert.rejects(handleEmbedCommand(embedInteraction({
  values: { description: '   ' },
  destination: { id: 'other-guild-text', type: ChannelType.GuildText, guildId: 'different-guild', send: async () => {} }
})), /text channel in this server/);

console.log('Ticket panel, ticket lifecycle, embed permissions, validation, and rules-template tests passed.');
