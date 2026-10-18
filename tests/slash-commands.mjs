import assert from 'node:assert/strict';
import { ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits } from 'discord.js';

process.env.DATABASE_PATH = ':memory:';
process.env.ECONOMY_DATABASE_PATH = ':memory:';

const { commands } = await import('../src/commands.js');
const { handlePrefixCommand, handleSlashCommand } = await import('../src/prefix.js');
const { config } = await import('../src/config.js');

const payload = commands.map((command) => command.toJSON());
const names = payload.map((command) => command.name);
assert.ok(payload.length <= 100, 'Discord supports at most 100 application commands per scope.');
assert.equal(new Set(names).size, names.length, 'Slash command names must be unique.');
assert.ok(payload.every((command) => command.default_member_permissions == null), 'Commands must not have restrictive default permissions.');
assert.ok(payload.every((command) =>
  command.integration_types?.includes(ApplicationIntegrationType.GuildInstall)
  && command.integration_types?.includes(ApplicationIntegrationType.UserInstall)
), 'Every command must support guild and user installation.');
assert.ok(!names.includes('dm') && !names.includes('cryptobalance'), 'Removed private-message and configured-only balance commands must not be registered.');
assert.ok(!names.some((name) => [
  'balance', 'tip', 'pay', 'daily', 'weekly', 'work', 'beg', 'leaderboard', 'profile', 'stats',
  'inventory', 'shop', 'buy', 'sell', 'economy', 'coinflip', 'dice', 'slots', 'blackjack', 'mines',
  'roulette', 'higherlower', 'duel', 'economy-config', 'economy-add', 'economy-remove', 'economy-set',
  'economy-reset', 'economy-user', 'economy-giveall'
].includes(name) && name !== 'balance'), 'Economy and gambling commands must not be registered.');
assert.ok(names.includes('setup') && names.includes('wallets') && names.includes('avatar') && names.includes('banner'));
const personalCommand = payload.find((command) => command.name === 'calc');
assert.deepEqual(personalCommand.integration_types, [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall]);
assert.deepEqual(personalCommand.contexts, [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);
const guildOnlyCommand = payload.find((command) => command.name === 'serverinfo');
assert.deepEqual(guildOnlyCommand.integration_types, [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall]);
assert.deepEqual(guildOnlyCommand.contexts, [InteractionContextType.Guild]);
const checkCommand = payload.find((command) => command.name === 'check');
assert.deepEqual(checkCommand.integration_types, [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall]);
assert.deepEqual(checkCommand.contexts, [InteractionContextType.Guild]);
assert.equal(checkCommand.options[0].name, 'users');
assert.equal(checkCommand.options[0].options.length, 10);
assert.equal(checkCommand.options[0].options[0].required, true);
assert.ok(checkCommand.options[0].options.slice(1).every((option) => !option.required));

const replies = [];
const nonAdminPermissions = { has: () => false };
const adminPermissions = {
  has: (permission) => permission === PermissionFlagsBits.Administrator
};
const interaction = {
  commandName: 'calc',
  user: { id: 'user-1', bot: false },
  options: { data: [{ name: 'expression', type: 3, value: '2 + 2' }] },
  deferred: true,
  replied: false,
  guild: null,
  memberPermissions: nonAdminPermissions,
  channel: { send: async () => ({}) },
  client: { user: { id: 'bot-1' } },
  editReply: async (payload) => {
    replies.push(payload);
    return payload;
  },
  reply: async (payload) => {
    replies.push(payload);
    return payload;
  }
};

assert.equal(await handleSlashCommand(interaction), true);
assert.match(replies[0], /Result: `4`/);

config.openAiApiKey = 'test-openai-key';
config.coingeckoApiKey = 'test-coingecko-key';
const originalFetch = globalThis.fetch;
const providerRequests = [];
globalThis.fetch = async (url, options) => {
  providerRequests.push({ url, options });
  if (url === 'https://api.openai.com/v1/chat/completions') {
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Mock OpenAI answer.' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ bitcoin: { usd: 65000 } }), { status: 200 });
};
const askReplies = [];
const askInteraction = {
  ...interaction,
  commandName: 'ask',
  options: { data: [{ name: 'question', type: 3, value: 'What is a test?' }] },
  editReply: async (payload) => askReplies.push(payload)
};
assert.equal(await handleSlashCommand(askInteraction), true);
assert.equal(askReplies[0], 'Mock OpenAI answer.');
assert.ok(new Headers(providerRequests[0].options.headers).has('authorization'));
const priceReplies = [];
const priceInteraction = {
  ...interaction,
  commandName: 'price',
  options: { data: [
    { name: 'coin', type: 3, value: 'bitcoin' },
    { name: 'currency', type: 3, value: 'usd' }
  ] },
  editReply: async (payload) => priceReplies.push(payload)
};
assert.equal(await handleSlashCommand(priceInteraction), true);
assert.match(priceReplies[0], /bitcoin: 65000 USD/);
assert.equal(providerRequests[1].options.headers['x-cg-demo-api-key'], 'test-coingecko-key');
const prefixAskReplies = [];
assert.equal(await handlePrefixCommand({
  author: { id: 'unprivileged-user', bot: false },
  content: '+ask prefix test',
  guild: null,
  channel: {},
  mentions: { users: { get: () => null, first: () => null } },
  reply: async (payload) => prefixAskReplies.push(payload)
}), true);
assert.equal(prefixAskReplies[0], 'Mock OpenAI answer.');
globalThis.fetch = originalFetch;

const sayMessages = [];
const sayReplies = [];
const sayInteraction = {
  ...interaction,
  commandName: 'say',
  user: { id: 'unprivileged-user', bot: false },
  options: { data: [{ name: 'message', type: 3, value: 'Public announcement' }] },
  channel: { send: async (content) => sayMessages.push(content) },
  editReply: async (payload) => sayReplies.push(payload),
  deleteReply: async () => { throw new Error('A denied /say must not delete its acknowledgement.'); }
};
assert.equal(await handleSlashCommand(sayInteraction), true);
assert.deepEqual(sayMessages, []);
assert.match(sayReplies[0], /not authorized/);

for (const userId of ['1347457775160266804', '1406878282275618826']) {
  let sayReplyDeleted = false;
  assert.equal(await handleSlashCommand({
    ...sayInteraction,
    user: { id: userId, bot: false },
    deleteReply: async () => { sayReplyDeleted = true; }
  }), true);
  assert.equal(
    sayMessages.at(-1),
    'Public announcement\n\n                                           -# Sent by leonidas'
  );
  assert.equal(sayReplyDeleted, true, '/say removes its deferred acknowledgement instead of posting confirmation text');
}

const administratorSayReplies = [];
assert.equal(await handleSlashCommand({
  ...sayInteraction,
  user: { id: 'administrator-not-allowlisted', bot: false },
  guild: {},
  memberPermissions: adminPermissions,
  editReply: async (payload) => administratorSayReplies.push(payload)
}), true);
assert.deepEqual(sayMessages, [
  'Public announcement\n\n                                           -# Sent by leonidas',
  'Public announcement\n\n                                           -# Sent by leonidas'
]);
assert.match(administratorSayReplies[0], /not authorized/);

for (const commandName of ['everyone', 'here']) {
  const sent = [];
  const repliesForMention = [];
  const mentionInteraction = {
    ...interaction,
    commandName,
    user: { id: 'unprivileged-user', bot: false },
    options: { data: [{ name: 'message', type: 3, value: 'Status update' }] },
    channel: {
      send: async (payload) => sent.push(payload),
      permissionsFor: () => { throw new Error('Command must not pre-check channel permissions.'); }
    },
    editReply: async (payload) => repliesForMention.push(payload)
  };
  assert.equal(await handleSlashCommand(mentionInteraction), true);
  assert.deepEqual(sent, []);
  assert.match(repliesForMention[0], /Administrator permission/);

  const adminRepliesForMention = [];
  assert.equal(await handleSlashCommand({
    ...mentionInteraction,
    guild: {},
    memberPermissions: adminPermissions,
    editReply: async (payload) => adminRepliesForMention.push(payload)
  }), true);
  assert.equal(sent[0].content, `${commandName === 'everyone' ? '@everyone' : '@here'} Status update`);
  assert.deepEqual(sent[0].allowedMentions, { parse: ['everyone'] });
  assert.equal(adminRepliesForMention[0], 'Mention sent.');
}

const blockedMentionReply = [];
const blockedMention = {
  ...interaction,
  commandName: 'everyone',
  guild: {},
  memberPermissions: adminPermissions,
  options: { data: [{ name: 'message', type: 3, value: 'Status update' }] },
  channel: { send: async () => { throw new Error('Missing Permissions'); } },
  editReply: async (payload) => blockedMentionReply.push(payload)
};
assert.equal(await handleSlashCommand(blockedMention), true);
assert.match(blockedMentionReply[0], /Missing Permissions/);
assert.doesNotMatch(blockedMentionReply[0], /Mention sent/);

const contextMessages = [];
const contextReplies = [];
const contextSay = {
  ...interaction,
  commandName: 'say',
  user: { id: '1347457775160266804', bot: false },
  options: { data: [{ name: 'message', type: 3, value: 'Context reply' }] },
  channel: null,
  followUp: async (payload) => contextMessages.push(payload),
  editReply: async (payload) => contextReplies.push(payload),
  deleteReply: async () => {}
};
assert.equal(await handleSlashCommand(contextSay), true);
assert.deepEqual(contextMessages, [{
  content: 'Context reply\n\n                                           -# Sent by leonidas'
}]);
assert.equal(contextReplies.length, 0);

const profileImages = [];
const profileUser = {
  id: 'profile-user',
  username: 'ProfileUser',
  avatar: 'a_animatedHash',
  banner: 'bannerHash',
  displayAvatarURL: ({ extension, size }) => `https://cdn.discordapp.com/avatars/profile-user/avatar.${extension}?size=${size}`,
  bannerURL: ({ extension, size }) => `https://cdn.discordapp.com/banners/profile-user/banner.${extension}?size=${size}`
};
const profileClient = { users: { fetch: async (id) => {
  assert.equal(id, profileUser.id);
  return profileUser;
} } };
const avatarInteraction = {
  ...interaction,
  commandName: 'avatar',
  user: profileUser,
  options: { getUser: () => null },
  client: profileClient,
  editReply: async (payload) => profileImages.push(payload)
};
assert.equal(await handleSlashCommand(avatarInteraction), true);
assert.match(profileImages[0].embeds[0].data.image.url, /\.gif\?size=512$/);
assert.equal(profileImages[0].components[0].components.length, 4);
const bannerInteraction = {
  ...avatarInteraction,
  commandName: 'banner',
  options: { getUser: () => profileUser }
};
assert.equal(await handleSlashCommand(bannerInteraction), true);
assert.match(profileImages[1].embeds[0].data.image.url, /\.png\?size=512$/);
const { handleProfileImageButton } = await import('../src/user-profile.js');
const buttonUpdates = [];
assert.equal(await handleProfileImageButton({
  customId: `profile-image:avatar:${profileUser.id}:128`,
  client: profileClient,
  user: { id: 'different-user' },
  update: async (payload) => buttonUpdates.push(payload)
}), true);
assert.match(buttonUpdates[0].embeds[0].data.image.url, /\.gif\?size=128$/);

const mentionedUser = {
  id: 'user-2',
  username: 'Target',
  toString() { return `<@${this.id}>`; }
};
const mentionReplies = [];
const vouchInteraction = {
  ...interaction,
  commandName: 'vouch',
  options: { data: [
    { name: 'user', type: 6, value: mentionedUser.id, user: mentionedUser },
    { name: 'message', type: 3, value: 'keeps promises' }
  ] },
  editReply: async (payload) => {
    mentionReplies.push(payload);
    return payload;
  }
};
assert.equal(await handleSlashCommand(vouchInteraction), true);
assert.match(mentionReplies[0], /\*\*Vouch\*\* for <@user-2>: keeps promises/);

const userReplies = [];
const selectedUser = {
  id: '100000000000000001',
  createdAt: new Date('2000-01-01T00:00:00.000Z')
};
const checkInteraction = {
  commandName: 'check',
  user: { id: 'staff-user', bot: false },
  memberPermissions: { has: () => true },
  options: {
    getSubcommand: () => 'users',
    getUser: (name) => name === 'user1' ? selectedUser : null
  },
  deferred: true,
  replied: false,
  guild: {
    members: {
      fetch: async (userId) => ({
        presence: { status: 'online' },
        roles: { cache: { has: () => false } },
        user: { id: userId }
      })
    }
  },
  channel: {},
  client: {},
  editReply: async (payload) => userReplies.push(payload),
  reply: async (payload) => userReplies.push(payload)
};
assert.equal(await handleSlashCommand(checkInteraction), true);
assert.match(userReplies[0], /Users checked: 1/);
assert.match(userReplies[0], /<@100000000000000001>/);
assert.match(userReplies[0], /Online/);

console.log(`Slash command tests passed: ${payload.length} definitions serialized; public routing, contexts, and permission-free registration verified.`);