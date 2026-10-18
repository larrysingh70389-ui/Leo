import assert from 'node:assert/strict';

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.CLIENT_ID ||= 'test-client';

const { addCalendarMonths, isUnderageAccount } = await import('../src/user-checks.js');
const { handlePrefixCommand, parsePrefixCommand } = await import('../src/prefix.js');
const { config } = await import('../src/config.js');

const roleId = config.verifiedRoleId;
const boundaryNow = new Date('2024-05-29T12:00:00.000Z');
const now = new Date();
const exactlyThreeMonthsAgo = addCalendarMonths(now, -3);
const insideThreeMonths = new Date(exactlyThreeMonthsAgo.getTime() + 24 * 60 * 60 * 1000);
assert.equal(addCalendarMonths(new Date('2024-01-31T12:00:00.000Z'), 1).toISOString(), '2024-02-29T12:00:00.000Z');
assert.equal(isUnderageAccount('2024-02-29T12:00:00.000Z', boundaryNow), false, 'exactly three calendar months is valid');
assert.equal(isUnderageAccount('2024-03-01T12:00:00.000Z', boundaryNow), true, 'less than three calendar months is underage');

const users = [
  { id: '100000000000000001', status: 'online', verified: true, createdAt: exactlyThreeMonthsAgo.toISOString() },
  { id: '100000000000000002', status: 'idle', verified: false, createdAt: insideThreeMonths.toISOString() },
  { id: '100000000000000003', status: 'dnd', verified: true, createdAt: '2023-01-01T12:00:00.000Z' },
  { id: '100000000000000004', status: null, verified: false, createdAt: '2023-01-01T12:00:00.000Z' },
  { id: '100000000000000005', status: 'departed', verified: false, createdAt: '2023-01-01T12:00:00.000Z' }
];
const userMap = new Map(users.map((user) => [user.id, { id: user.id, createdAt: new Date(user.createdAt) }]));
const responseMessage = {
  author: { id: 'staff-1', bot: false },
  member: { permissions: { has: () => true } },
  content: `+check users ${users.map((user) => `<@${user.id}>`).join(' ')} <@100000000000000001>`,
  mentions: { users: { get: (id) => userMap.get(id) || null } },
  guild: {
    members: {
      fetch: async (id) => {
        const user = users.find((entry) => entry.id === id);
        if (user.status === 'departed') throw Object.assign(new Error('Unknown Member'), { code: 10007 });
        return {
          presence: user.status ? { status: user.status } : null,
          roles: { cache: { has: (candidateRoleId) => candidateRoleId === roleId && user.verified } }
        };
      }
    }
  },
  replyCount: 0,
  reply: async (content) => {
    responseMessage.replyCount += 1;
    responseMessage.response = content;
  }
};

assert.equal(parsePrefixCommand(responseMessage)?.name, 'check');
assert.deepEqual(parsePrefixCommand(responseMessage)?.args.slice(0, 2), ['users', '<@100000000000000001>']);
assert.equal(await handlePrefixCommand(responseMessage), true);
assert.equal(responseMessage.replyCount, 1, 'the public prefix command responds once');
assert.match(responseMessage.response, /Users checked: 5/);
assert.match(responseMessage.response, /🟢 Online:\n<@100000000000000001>/);
assert.match(responseMessage.response, /🌙 Idle:\n<@100000000000000002>/);
assert.match(responseMessage.response, /⛔ Do Not Disturb:\n<@100000000000000003>/);
assert.match(responseMessage.response, /⚫ Offline:\n<@100000000000000004>/);
assert.match(responseMessage.response, /🚪 Left server:\n<@100000000000000005>/);
assert.match(responseMessage.response, /✅ Verified:\n<@100000000000000001>\n<@100000000000000003>/);
assert.match(responseMessage.response, /❌ Unverified:\n<@100000000000000002>\n<@100000000000000004>\n<@100000000000000005>/);
assert.match(responseMessage.response, /🔴 Accounts under 3 months:\n<@100000000000000002>/);
assert.doesNotMatch(responseMessage.response, /invite/i);

const noUsersResponse = [];
assert.equal(await handlePrefixCommand({
  ...responseMessage,
  content: '+check users',
  reply: async (content) => noUsersResponse.push(content)
}), true);
assert.match(noUsersResponse[0], /Mention at least one server user/);

console.log('User check tests passed.');