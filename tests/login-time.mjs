import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { PermissionFlagsBits } from 'discord.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'leonidas-login-time-'));
const databasePath = path.join(databaseDirectory, 'login-time.sqlite');
const legacyDatabasePath = path.join(databaseDirectory, 'unused-legacy.sqlite');
let databaseModule;
process.env.DATABASE_PATH = databasePath;
process.env.ECONOMY_DATABASE_PATH = legacyDatabasePath;
process.env.TIMEZONE = 'Asia/Kolkata';
process.env.DISCORD_TOKEN ||= 'test-token';
process.env.CLIENT_ID ||= 'test-client';

try {
  const loginTime = await import('../src/login-time.js');
  databaseModule = await import('../src/database.js');
  const commandsModule = await import('../src/commands.js');
  const {
    formatDuration,
    getLoginWeek,
    handleLoginTimeButton,
    handleLoginTimeCommand,
    splitDurationByWeek
  } = loginTime;

  const sundayAtEleven = Date.parse('2026-09-27T17:30:00.000Z');
  const mondayAtTwo = Date.parse('2026-09-27T20:30:00.000Z');
  const priorWeek = getLoginWeek(sundayAtEleven);
  const currentWeek = getLoginWeek(mondayAtTwo);
  assert.equal(priorWeek.id, '2026-W39');
  assert.equal(currentWeek.id, '2026-W40');
  assert.equal(currentWeek.start, Date.parse('2026-09-27T18:30:00.000Z'));
  assert.equal(getLoginWeek(Date.parse('2021-01-01T12:00:00.000Z')).id, '2020-W53');
  assert.equal(getLoginWeek(Date.parse('2027-01-01T12:00:00.000Z')).id, '2026-W53');
  assert.deepEqual(splitDurationByWeek(sundayAtEleven, mondayAtTwo), [
    { weekId: '2026-W39', durationMs: 60 * 60 * 1000 },
    { weekId: '2026-W40', durationMs: 2 * 60 * 60 * 1000 }
  ]);
  assert.equal(formatDuration(45_000), '45 seconds');
  assert.equal(formatDuration((2 * 86400 + 7 * 3600 + 18 * 60) * 1000), '2d 7h 18m');

  function interaction(userId, subcommand, now, { all = false, administrator = false } = {}) {
    const replies = [];
    return {
      replies,
      user: { id: userId, toString: () => `<@${userId}>` },
      guild: {},
      memberPermissions: {
        has: (permission) => administrator && permission === PermissionFlagsBits.Administrator
      },
      customId: '',
      deferred: true,
      replied: false,
      options: {
        getSubcommand: () => subcommand,
        getBoolean: (name) => name === 'all' ? all : null
      },
      async editReply(payload) { replies.push(payload); return payload; },
      async reply(payload) { replies.push(payload); return payload; },
      async update(payload) { replies.push(payload); return payload; },
      now
    };
  }

  const user = 'user-cross-week';
  const start = interaction(user, 'in', sundayAtEleven);
  assert.equal(await handleLoginTimeCommand(start, sundayAtEleven), true);
  assert.match(start.replies[0].content, /You are now logged in/);
  const duplicateStart = interaction(user, 'in', sundayAtEleven + 1000);
  await handleLoginTimeCommand(duplicateStart, sundayAtEleven + 1000);
  assert.equal(duplicateStart.replies[0].content, '❌ You are already logged in.');

  const activeStatus = interaction(user, 'time', mondayAtTwo);
  await handleLoginTimeCommand(activeStatus, mondayAtTwo);
  assert.match(activeStatus.replies[0].embeds[0].data.description, /Total this week: \*\*2h 0m\*\*/);
  assert.match(activeStatus.replies[0].embeds[0].data.description, /Current session: 3h 0m/);

  const restartedSession = JSON.parse(execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import { getLoginSession } from ${JSON.stringify(pathToFileURL(path.resolve('src/database.js')).href)}; console.log(JSON.stringify(getLoginSession(${JSON.stringify(user)})));`
  ], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_PATH: databasePath, ECONOMY_DATABASE_PATH: legacyDatabasePath, TIMEZONE: 'Asia/Kolkata' },
    encoding: 'utf8'
  }));
  assert.equal(restartedSession.started_at, sundayAtEleven, 'active login survives another database connection/process');

  const stop = interaction(user, 'out', mondayAtTwo);
  await handleLoginTimeCommand(stop, mondayAtTwo);
  assert.match(stop.replies[0].content, /Session: 3h 0m/);
  assert.match(stop.replies[0].content, /Total this week: 2h 0m/);
  assert.equal(databaseModule.getLoginWeeklyTotal(user, priorWeek.id), 60 * 60 * 1000);
  assert.equal(databaseModule.getLoginWeeklyTotal(user, currentWeek.id), 2 * 60 * 60 * 1000);
  const duplicateStop = interaction(user, 'out', mondayAtTwo);
  await handleLoginTimeCommand(duplicateStop, mondayAtTwo);
  assert.equal(duplicateStop.replies[0].content, '❌ You are not currently logged in.');

  const afterLogout = interaction(user, 'time', mondayAtTwo);
  await handleLoginTimeCommand(afterLogout, mondayAtTwo);
  assert.match(afterLogout.replies[0].embeds[0].data.description, /Current session: Not logged in/);
  const leaderboard = interaction(user, 'leaderboard', mondayAtTwo);
  await handleLoginTimeCommand(leaderboard, mondayAtTwo);
  assert.match(leaderboard.replies[0].embeds[0].data.description, /<@user-cross-week> — \*\*2h 0m\*\*/);
  assert.equal(leaderboard.replies[0].components.length, 1);

  const activeResetUser = 'user-reset-active';
  const mondayNine = Date.parse('2026-09-28T03:30:00.000Z');
  const mondayOne = Date.parse('2026-09-28T07:30:00.000Z');
  const mondayTwo = Date.parse('2026-09-28T08:30:00.000Z');
  const mondayThree = Date.parse('2026-09-28T09:30:00.000Z');
  assert.equal(databaseModule.startLoginSession(activeResetUser, mondayNine - 2 * 60 * 60 * 1000), true);
  databaseModule.finishLoginSession(activeResetUser, mondayNine, splitDurationByWeek);
  assert.equal(databaseModule.startLoginSession(activeResetUser, mondayNine), true);
  const resetPrompt = interaction(activeResetUser, 'reset', mondayOne);
  await handleLoginTimeCommand(resetPrompt, mondayOne);
  assert.match(resetPrompt.replies[0].content, /Are you sure/);
  const unauthorizedUserReset = interaction('another-user', 'reset', mondayTwo);
  unauthorizedUserReset.customId = resetPrompt.replies[0].components[0].components[0].data.custom_id;
  await assert.rejects(
    handleLoginTimeButton(unauthorizedUserReset, mondayTwo),
    /Only the user who requested this reset can confirm it/
  );
  assert.equal(databaseModule.getLoginWeeklyTotal(activeResetUser, currentWeek.id), 2 * 60 * 60 * 1000);
  const unauthorizedCancel = interaction('another-user', 'reset', mondayTwo);
  unauthorizedCancel.customId = resetPrompt.replies[0].components[0].components[1].data.custom_id;
  await assert.rejects(
    handleLoginTimeButton(unauthorizedCancel, mondayTwo),
    /Only the user who requested this reset can cancel it/
  );
  const confirmReset = interaction(activeResetUser, 'reset', mondayTwo);
  confirmReset.customId = resetPrompt.replies[0].components[0].components[0].data.custom_id;
  await handleLoginTimeButton(confirmReset, mondayTwo);
  assert.equal(confirmReset.replies[0].content, '✅ Your login time for this week has been reset.');
  assert.equal(databaseModule.getLoginSession(activeResetUser).started_at, mondayNine);
  assert.equal(databaseModule.getLoginWeeklyTotal(activeResetUser, currentWeek.id), 0);
  const resetStatus = interaction(activeResetUser, 'time', mondayThree);
  await handleLoginTimeCommand(resetStatus, mondayThree);
  assert.match(resetStatus.replies[0].embeds[0].data.description, /Current session: 6h 0m/);
  assert.match(resetStatus.replies[0].embeds[0].data.description, /Total this week: \*\*1h 0m\*\*/);
  databaseModule.finishLoginSession(activeResetUser, mondayThree, splitDurationByWeek);
  assert.equal(databaseModule.getLoginWeeklyTotal(activeResetUser, currentWeek.id), 60 * 60 * 1000);
  assert.equal(databaseModule.startLoginSession(activeResetUser, mondayThree), true);

  const deniedResetAll = interaction('unprivileged-user', 'reset', mondayThree, { all: true });
  await assert.rejects(
    handleLoginTimeCommand(deniedResetAll, mondayThree),
    /Administrator permission in a server is required/
  );
  assert.equal(deniedResetAll.replies.length, 0, 'non-admins receive no global reset confirmation');

  const resetAll = interaction('admin-user', 'reset', mondayThree, { all: true, administrator: true });
  await handleLoginTimeCommand(resetAll, mondayThree);
  assert.match(resetAll.replies[0].content, /ALL users/);
  const unauthorizedButton = interaction('unprivileged-user', 'reset', mondayThree);
  unauthorizedButton.customId = resetAll.replies[0].components[0].components[0].data.custom_id;
  await assert.rejects(
    handleLoginTimeButton(unauthorizedButton, mondayThree),
    /Administrator permission in a server is required/
  );
  assert.ok(databaseModule.getLoginWeeklyTotal(activeResetUser, currentWeek.id) > 0, 'non-admin button clicks do not reset totals');

  const confirmAll = interaction('admin-user', 'reset', mondayThree, { administrator: true });
  confirmAll.customId = unauthorizedButton.customId;
  await handleLoginTimeButton(confirmAll, mondayThree);
  assert.equal(confirmAll.replies[0].content, '✅ This week’s login totals have been reset for everyone.');
  assert.equal(databaseModule.getLoginSession(activeResetUser).started_at, mondayThree, 'all-user reset leaves active sessions running');
  assert.equal(databaseModule.getLoginWeeklyTotal(activeResetUser, currentWeek.id), 0);
  assert.equal(databaseModule.getLoginWeeklyTotal(user, priorWeek.id), 60 * 60 * 1000, 'all-user reset preserves historical weeks');

  const emptyBoard = interaction('empty-user', 'leaderboard', mondayThree);
  await handleLoginTimeCommand(emptyBoard, mondayThree);
  assert.match(emptyBoard.replies[0].embeds[0].data.description, /No login time recorded/);

  const longStart = Date.parse('2026-09-01T00:00:00.000Z');
  const longEnd = Date.parse('2026-10-15T00:00:00.000Z');
  const longSegments = splitDurationByWeek(longStart, longEnd);
  assert.ok(longSegments.length >= 6, 'long sessions split at each weekly boundary');
  assert.equal(longSegments.reduce((total, segment) => total + segment.durationMs, 0), longEnd - longStart);

  for (let index = 0; index < 12; index += 1) {
    const id = `page-user-${String(index).padStart(2, '0')}`;
    databaseModule.startLoginSession(id, mondayNine);
    databaseModule.finishLoginSession(id, mondayNine + (index + 1) * 60_000, splitDurationByWeek);
  }
  const paginatedBoard = interaction(user, 'leaderboard', mondayThree);
  await handleLoginTimeCommand(paginatedBoard, mondayThree);
  assert.ok(paginatedBoard.replies[0].components[0].components[1].data.custom_id.endsWith(':1'));
  const secondPage = interaction(user, 'leaderboard', mondayThree);
  secondPage.customId = `login-time:page:${user}:1`;
  await handleLoginTimeButton(secondPage, mondayThree);
  assert.ok(secondPage.replies[0].embeds[0].data.footer.text.startsWith('Page 2 of'));
  assert.match(secondPage.replies[0].embeds[0].data.description, /(?:^|\n)11\. <@/);

  const logCommand = commandsModule.commands.find((command) => command.name === 'log').toJSON();
  const logActions = logCommand.options.map((option) => option.name);
  assert.deepEqual(logActions, ['in', 'out', 'time', 'leaderboard', 'reset']);
  assert.equal(logCommand.options.at(-1).options[0].name, 'all');
  assert.equal(logCommand.options.at(-1).options[0].type, 5);

  console.log('Login time tests passed: commands, weekly splitting, resets, persistence, and pagination.');
} finally {
  databaseModule?.close();
  rmSync(databaseDirectory, { recursive: true, force: true });
}
