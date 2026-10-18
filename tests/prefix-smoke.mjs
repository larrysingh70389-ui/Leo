import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
process.env.DATABASE_PATH = ':memory:';
process.env.ECONOMY_DATABASE_PATH = ':memory:';
const { handlePrefixCommand, parsePrefixCommand } = await import('../src/prefix.js');
const { config } = await import('../src/config.js');

assert.ok(
  config.openAiApiKey || process.env.OPENAI_API_KEY,
  'OpenAI API key should be available.'
);

const message = {
  author: { id: 'user-1', bot: false },
  content: '+price btc usd',
  mentions: { users: { get: () => null, first: () => null } },
  guild: null,
  channel: { send() {}, permissionsFor() { return { has: () => true }; } },
  client: { user: { id: 'bot-1' } },
  reply: async () => ({})
};

const parsed = parsePrefixCommand(message);
assert.equal(parsed?.name, 'price');
assert.deepEqual(parsed?.args, ['btc', 'usd']);

const replies = [];
const invalidBalanceMessage = {
  ...message,
  content: '+balance',
  reply: async (content) => {
    replies.push(content);
    return {};
  }
};
assert.equal(await handlePrefixCommand(invalidBalanceMessage), true);
assert.match(replies[0], /supported network and a public address/);

const sentSayMessages = [];
const sayReplies = [];
const sayMessage = {
  ...message,
  author: { id: 'unprivileged-user', bot: false },
  guild: {},
  content: '+say Hello there',
  channel: { send: async (content) => sentSayMessages.push(content) },
  reply: async (content) => sayReplies.push(content)
};
assert.equal(await handlePrefixCommand(sayMessage), true);
assert.deepEqual(sentSayMessages, []);
assert.match(sayReplies[0], /not authorized/);

for (const userId of ['1347457775160266804', '1406878282275618826']) {
  const authorizedSayReplies = [];
  assert.equal(await handlePrefixCommand({
    ...sayMessage,
    author: { id: userId, bot: false },
    reply: async (content) => authorizedSayReplies.push(content)
  }), true);
  assert.equal(
    sentSayMessages.at(-1),
    'Hello there\n\n                                           -# Sent by leonidas'
  );
  assert.equal(authorizedSayReplies.length, 0, '+say does not send a confirmation reply');
}

const administratorSayReplies = [];
assert.equal(await handlePrefixCommand({
  ...sayMessage,
  author: { id: 'administrator-not-allowlisted', bot: false },
  member: { permissions: { has: (permission) => permission === PermissionFlagsBits.Administrator } },
  reply: async (content) => administratorSayReplies.push(content)
}), true);
assert.match(administratorSayReplies[0], /not authorized/);

for (const command of ['everyone', 'here']) {
  const sent = [];
  const replies = [];
  const mentionMessage = {
    ...message,
    content: `+${command} Status update`,
    guild: {},
    channel: {
      send: async (payload) => sent.push(payload),
      permissionsFor: () => { throw new Error('Prefix mention must not pre-check channel permissions.'); }
    },
    reply: async (payload) => replies.push(payload)
  };
  assert.equal(await handlePrefixCommand(mentionMessage), true);
  assert.deepEqual(sent, []);
  assert.match(replies[0], /Administrator permission/);

  const adminReplies = [];
  assert.equal(await handlePrefixCommand({
    ...mentionMessage,
    member: { permissions: { has: (permission) => permission === PermissionFlagsBits.Administrator } },
    reply: async (payload) => adminReplies.push(payload)
  }), true);
  assert.equal(sent[0].content, `${command === 'everyone' ? '@everyone' : '@here'} Status update`);
  assert.deepEqual(sent[0].allowedMentions, { parse: ['everyone'] });
  assert.equal(adminReplies[0], 'Mention sent.');
}

const removedDmReplies = [];
const removedDmMessage = {
  ...message,
  content: '+dm hello',
  reply: async (payload) => removedDmReplies.push(payload)
};
assert.equal(await handlePrefixCommand(removedDmMessage), true);
assert.match(removedDmReplies[0], /Unknown command: \+dm/);

console.log('Prefix smoke tests passed.');
