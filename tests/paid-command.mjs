import assert from 'node:assert/strict';

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.CLIENT_ID ||= 'test-client';
process.env.DATABASE_PATH = ':memory:';
process.env.ECONOMY_DATABASE_PATH = ':memory:';

const { handlePrefixCommand, handleSlashCommand } = await import('../src/prefix.js');
const { config } = await import('../src/config.js');

const proofImage = {
  name: 'receipt.webp',
  contentType: 'image/webp',
  url: 'https://cdn.discordapp.com/attachments/test/receipt.webp'
};
const recipient = { id: '100000000000000001' };
let nextProofId = 1;

function createMessage({
  commandName = 'paidticket',
  content = `+${commandName} 500 <@${recipient.id}>`,
  authorized = true,
  hasReply = true,
  referenceFails = false,
  renameFails = false,
  proofChannelFails = false,
  missingProofPermission = false,
  deliveryFails = 0,
  summaryFailures = 0,
  proofAttachments = [proofImage],
  commandAttachments = []
} = {}) {
  const calls = {
    rename: [],
    ticket: [],
    proofChannel: [],
    summaryAttempts: 0,
    replies: [],
    forward: [],
    fetchGuild: [],
    fetchChannel: []
  };
  const ticketChannel = {
    name: `ticket-${nextProofId}`,
    async setName(name) {
      calls.rename.push(name);
      if (renameFails) throw Object.assign(new Error('Missing permissions'), { code: 50013 });
      this.name = name;
    },
    async send(payload) {
      if (deliveryFails > 0) {
        deliveryFails -= 1;
        throw new Error('Temporary send failure');
      }
      calls.ticket.push(payload);
    }
  };
  const proofChannel = {
    id: config.paidConfirmationChannelId,
    async send(payload) {
      if (payload.content?.startsWith('**Paid ')) {
        calls.summaryAttempts += 1;
        if (summaryFailures > 0) {
          summaryFailures -= 1;
          throw new Error('Temporary summary failure');
        }
      }
      calls.proofChannel.push(payload);
      return { id: `proof-channel-message-${calls.proofChannel.length}` };
    },
    permissionsFor() {
      return { has: () => !missingProofPermission };
    }
  };
  const proofMessage = {
    id: `source-proof-${nextProofId++}`,
    content: 'Original payment proof text',
    attachments: new Map(proofAttachments.map((attachment, index) => [String(index), attachment])),
    async forward(channel) {
      calls.forward.push(channel);
      return await channel.send({ forward: { message: this.id } });
    }
  };
  const message = {
    author: { id: 'staff-user', bot: false },
    member: { roles: { cache: { has: (roleId) => authorized && roleId === config.paidStaffRoleId } } },
    content,
    mentions: { users: { get: (id) => id === recipient.id ? recipient : null } },
    attachments: new Map(commandAttachments.map((attachment, index) => [String(index), attachment])),
    reference: hasReply ? { messageId: proofMessage.id } : null,
    async fetchReference() {
      if (referenceFails) throw new Error('Unknown message');
      return proofMessage;
    },
    guild: { id: 'some-ticket-guild' },
    channel: ticketChannel,
    client: {
      user: { id: 'bot-user' },
      guilds: {
        async fetch(id) {
          calls.fetchGuild.push(id);
          if (proofChannelFails) throw new Error('Unknown guild');
          return {
            id,
            channels: {
              async fetch(channelId) {
                calls.fetchChannel.push(channelId);
                return proofChannel;
              }
            }
          };
        }
      }
    },
    async reply(payload) { calls.replies.push(payload); }
  };
  return { message, calls, proofMessage, proofChannel };
}

function assertNoPaidSideEffects(calls) {
  assert.equal(calls.forward.length, 0);
  assert.equal(calls.proofChannel.length, 0);
  assert.equal(calls.ticket.length, 0);
  assert.equal(calls.rename.length, 0);
}

{
  const { message, calls, proofChannel, proofMessage } = createMessage({
    commandAttachments: [{ name: 'wrong-proof.png', url: 'https://example.com/wrong-proof.png' }]
  });
  assert.equal(await handlePrefixCommand(message), true);
  assert.deepEqual(calls.fetchGuild, [config.paidConfirmationGuildId]);
  assert.deepEqual(calls.fetchChannel, [config.paidConfirmationChannelId]);
  assert.deepEqual(calls.forward, [proofChannel], 'forward the replied-to proof to the configured channel');
  assert.equal(calls.proofChannel.length, 2, 'native forward and payment summary are posted separately');
  assert.deepEqual(calls.proofChannel[0], { forward: { message: proofMessage.id } });
  assert.equal(calls.proofChannel[1].content, `**Paid 500 to <@${recipient.id}>**`);
  assert.deepEqual(calls.proofChannel[1].allowedMentions, { users: [recipient.id] });
  assert.deepEqual(calls.rename, ['paid']);
  assert.equal(calls.ticket.length, 1, 'delivery confirmation is sent once');
  assert.equal(calls.ticket[0].content, '**your reward has been delivered please check and vouch me in https://discord.com/channels/1536742466525593722/1545802752783941674**');
  assert.deepEqual(calls.ticket[0].files, [{ attachment: proofImage.url, name: proofImage.name }]);
  assert.equal(calls.replies.length, 0);
}

{
  const { message, calls } = createMessage({ hasReply: false });
  assert.equal(await handlePrefixCommand(message), true);
  assert.equal(calls.replies[0], '❌ Reply to the payment proof message, then use +paidticket <amount> @user.');
  assertNoPaidSideEffects(calls);
}

{
  const { message, calls } = createMessage({ referenceFails: true });
  assert.equal(await handlePrefixCommand(message), true);
  assert.equal(calls.replies[0], '❌ Reply to the payment proof message, then use +paidticket <amount> @user.');
  assertNoPaidSideEffects(calls);
}

for (const content of [
  '+paidticket',
  '+paidticket nope <@100000000000000001>',
  '+paidticket 0 <@100000000000000001>',
  '+paidticket -1 <@100000000000000001>'
]) {
  const { message, calls } = createMessage({ content });
  assert.equal(await handlePrefixCommand(message), true);
  assert.match(calls.replies[0], /valid positive amount/);
  assertNoPaidSideEffects(calls);
}

{
  const { message, calls } = createMessage({ content: '+paidticket 500' });
  assert.equal(await handlePrefixCommand(message), true);
  assert.match(calls.replies[0], /Mention one Discord user/);
  assertNoPaidSideEffects(calls);
}

{
  const { message, calls } = createMessage({ authorized: false });
  assert.equal(await handlePrefixCommand(message), true);
  assert.match(calls.replies[0], /authorized staff/);
  assertNoPaidSideEffects(calls);
}

{
  const { message, calls } = createMessage({ renameFails: true });
  assert.equal(await handlePrefixCommand(message), true);
  assert.deepEqual(calls.rename, ['paid']);
  assert.equal(calls.proofChannel.length, 2, 'proof and summary remain posted if channel rename fails');
  assert.equal(calls.ticket.length, 1, 'delivery confirmation continues if channel rename fails');
  assert.match(calls.replies[0], /Could not rename this ticket channel/);
}

{
  const { message, calls } = createMessage({ proofChannelFails: true });
  assert.equal(await handlePrefixCommand(message), true);
  assert.match(calls.replies[0], /Unknown guild/);
  assertNoPaidSideEffects(calls);
}

{
  const { message, calls } = createMessage({ missingProofPermission: true });
  assert.equal(await handlePrefixCommand(message), true);
  assert.match(calls.replies[0], /cannot access or send payment proofs/);
  assertNoPaidSideEffects(calls);
}

{
  const { message, calls } = createMessage({ deliveryFails: 1 });
  assert.equal(await handlePrefixCommand(message), true);
  assert.equal(calls.forward.length, 1);
  assert.equal(calls.proofChannel.length, 2);
  assert.equal(calls.ticket.length, 0);
  assert.match(calls.replies[0], /Could not send the delivery message/);

  const retry = { ...message, channel: message.channel, replies: calls.replies };
  assert.equal(await handlePrefixCommand(retry), true);
  assert.equal(calls.forward.length, 1, 'retry does not duplicate a successfully forwarded proof');
  assert.equal(calls.proofChannel.length, 2, 'retry does not duplicate the payment summary');
  assert.equal(calls.ticket.length, 1, 'retry completes the delivery confirmation');
}

{
  const { message, calls } = createMessage({ summaryFailures: 1 });
  assert.equal(await handlePrefixCommand(message), true);
  assert.equal(calls.forward.length, 1);
  assert.equal(calls.summaryAttempts, 1);
  assert.equal(calls.proofChannel.length, 1, 'failed summary is not treated as successfully sent');
  assert.equal(calls.ticket.length, 1);
  assert.match(calls.replies[0], /Could not send the payment summary/);

  assert.equal(await handlePrefixCommand(message), true);
  assert.equal(calls.forward.length, 1, 'retry does not duplicate a successfully forwarded proof');
  assert.equal(calls.summaryAttempts, 2);
  assert.equal(calls.proofChannel.length, 2, 'retry sends the missing summary once');
  assert.equal(calls.ticket.length, 1, 'retry does not duplicate a successful delivery confirmation');
}

{
  const slashCalls = { rename: [], ticket: [], proofChannel: [], replies: [], deleteReply: 0 };
  const slashAttachment = { name: 'slash-proof.png', url: 'https://cdn.discordapp.com/attachments/test/slash-proof.png' };
  const slashInteraction = {
    id: 'paid-slash-interaction',
    commandName: 'paidticket',
    user: { id: 'staff-user', bot: false },
    member: { roles: [config.paidStaffRoleId] },
    memberPermissions: { has: () => true },
    options: {
      getNumber: (name) => name === 'amount' ? 500 : null,
      getUser: (name) => name === 'user' ? recipient : null,
      getAttachment: (name) => name === 'screenshot' ? slashAttachment : null
    },
    deferred: true,
    replied: false,
    guild: { id: 'some-ticket-guild' },
    channel: {
      name: 'ticket-slash',
      async setName(name) { slashCalls.rename.push(name); },
      async send(payload) { slashCalls.ticket.push(payload); }
    },
    client: {
      user: { id: 'bot-user' },
      guilds: {
        async fetch(id) {
          assert.equal(id, config.paidConfirmationGuildId);
          return {
            id,
            channels: { fetch: async (channelId) => {
              assert.equal(channelId, config.paidConfirmationChannelId);
              return {
                send: async (payload) => slashCalls.proofChannel.push(payload),
                permissionsFor: () => ({ has: () => true })
              };
            } }
          };
        }
      }
    },
    async editReply(payload) { slashCalls.replies.push(payload); },
    async reply(payload) { slashCalls.replies.push(payload); },
    async deleteReply() { slashCalls.deleteReply += 1; }
  };
  assert.equal(await handleSlashCommand(slashInteraction), true);
  assert.deepEqual(slashCalls.rename, ['paid']);
  assert.equal(slashCalls.proofChannel[0].content, `**Paid 500 to <@${recipient.id}>**`);
  assert.deepEqual(slashCalls.proofChannel[0].files, [{ attachment: slashAttachment.url, name: slashAttachment.name }]);
  assert.equal(slashCalls.ticket[0].content, '**your reward has been delivered please check and vouch me in https://discord.com/channels/1536742466525593722/1545802752783941674**');
  assert.equal(slashCalls.deleteReply, 1, 'successful slash command clears its deferred acknowledgement');
  assert.equal(slashCalls.replies.length, 0);
}

console.log('Paid command tests passed.');
