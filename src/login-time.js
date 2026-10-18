import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { config } from './config.js';
import {
  finishLoginSession,
  getLoginSession,
  getLoginWeeklyTotal,
  listLoginTimeUsers,
  resetAllLoginWeekly,
  resetLoginWeekly,
  startLoginSession
} from './database.js';

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: config.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

function localParts(timestamp) {
  const parts = Object.fromEntries(timeFormatter.formatToParts(new Date(timestamp))
    .filter((part) => part.type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function localDateTimeToTimestamp({ year, month, day, hour = 0, minute = 0, second = 0 }) {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = target;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const parts = localParts(candidate);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const difference = target - represented;
    candidate += difference;
    if (difference === 0) return candidate;
  }

  const targetDay = Date.UTC(year, month - 1, day);
  const matches = [];
  for (let timestamp = candidate - 4 * 60 * 60 * 1000; timestamp <= candidate + 4 * 60 * 60 * 1000; timestamp += 60 * 1000) {
    const parts = localParts(timestamp);
    if (Date.UTC(parts.year, parts.month - 1, parts.day) !== targetDay) continue;
    const localTime = ((parts.hour * 60 + parts.minute) * 60) + parts.second;
    const targetTime = ((hour * 60 + minute) * 60) + second;
    if (localTime >= targetTime) matches.push({ timestamp, localTime });
  }
  if (matches.length) {
    matches.sort((left, right) => left.localTime - right.localTime || left.timestamp - right.timestamp);
    return matches[0].timestamp;
  }
  throw new Error(`Could not resolve a local date boundary in timezone ${config.timezone}.`);
}

function getWeekForDate(year, month, day) {
  const dayNumber = Date.UTC(year, month - 1, day);
  const weekday = new Date(dayNumber).getUTCDay();
  const mondayNumber = dayNumber - ((weekday + 6) % 7) * 24 * 60 * 60 * 1000;
  const monday = new Date(mondayNumber);
  const mondayDate = {
    year: monday.getUTCFullYear(),
    month: monday.getUTCMonth() + 1,
    day: monday.getUTCDate()
  };
  const nextMonday = new Date(mondayNumber + 7 * 24 * 60 * 60 * 1000);
  const thursday = new Date(mondayNumber + 3 * 24 * 60 * 60 * 1000);
  const isoYear = thursday.getUTCFullYear();
  const januaryFourth = Date.UTC(isoYear, 0, 4);
  const firstMonday = januaryFourth - ((new Date(januaryFourth).getUTCDay() + 6) % 7) * 24 * 60 * 60 * 1000;
  const weekNumber = Math.floor((mondayNumber - firstMonday) / (7 * 24 * 60 * 60 * 1000)) + 1;

  return {
    id: `${isoYear}-W${String(weekNumber).padStart(2, '0')}`,
    start: localDateTimeToTimestamp(mondayDate),
    end: localDateTimeToTimestamp({
      year: nextMonday.getUTCFullYear(),
      month: nextMonday.getUTCMonth() + 1,
      day: nextMonday.getUTCDate()
    }),
    mondayDate
  };
}

export function getLoginWeek(timestamp = Date.now()) {
  const { year, month, day } = localParts(timestamp);
  return getWeekForDate(year, month, day);
}

export function splitDurationByWeek(startTimestamp, endTimestamp) {
  if (!Number.isSafeInteger(startTimestamp) || !Number.isSafeInteger(endTimestamp)) {
    throw new Error('Login timestamps must be safe whole-number milliseconds.');
  }
  if (endTimestamp < startTimestamp) throw new Error('Logout time cannot be before login time.');

  const segments = [];
  let cursor = startTimestamp;
  while (cursor < endTimestamp) {
    const week = getLoginWeek(cursor);
    const segmentEnd = Math.min(endTimestamp, week.end);
    if (segmentEnd <= cursor) throw new Error('Could not advance to the next login week boundary.');
    segments.push({ weekId: week.id, durationMs: segmentEnd - cursor });
    cursor = segmentEnd;
  }
  return segments;
}

export function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error('Duration must be a non-negative number.');
  let seconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function formatDate(date, options) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(
    new Date(Date.UTC(date.year, date.month - 1, date.day))
  );
}

function formatWeek(week) {
  const sunday = new Date(Date.UTC(
    week.mondayDate.year,
    week.mondayDate.month - 1,
    week.mondayDate.day + 6
  ));
  const sundayDate = { year: sunday.getUTCFullYear(), month: sunday.getUTCMonth() + 1, day: sunday.getUTCDate() };
  return `${formatDate(week.mondayDate, { weekday: 'long', month: 'long', day: 'numeric' })} – ${formatDate(sundayDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;
}

function formatLocalTimestamp(timestamp) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(timestamp));
}

function currentWeekTotal(userId, week, now) {
  let total = getLoginWeeklyTotal(userId, week.id);
  const session = getLoginSession(userId);
  if (session) {
    const activeStart = Math.max(session.accounting_since_at, week.start);
    total += Math.max(0, now - activeStart);
  }
  return total;
}

function leaderboardRows(week, now) {
  return listLoginTimeUsers()
    .map((userId) => ({ userId, totalMs: currentWeekTotal(userId, week, now) }))
    .filter((row) => row.totalMs > 0)
    .sort((left, right) => right.totalMs - left.totalMs || left.userId.localeCompare(right.userId));
}

function leaderboardEmbed(week, rows, page) {
  const start = page * 10;
  const pageRows = rows.slice(start, start + 10);
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  const lines = pageRows.map((row, index) => {
    const rank = start + index + 1;
    const label = rank <= medals.length ? medals[rank - 1] : `${rank}.`;
    return `${label} <@${row.userId}> — **${formatDuration(row.totalMs)}**`;
  });
  const embed = new EmbedBuilder()
    .setTitle('🏆 LOGIN TIME LEADERBOARD')
    .setDescription(`📅 ${formatWeek(week)}\n\n${lines.length ? lines.join('\n') : 'No login time recorded this week.'}`)
    .setColor(0x5865f2)
    .setFooter({ text: `Page ${page + 1} of ${Math.max(1, Math.ceil(rows.length / 10))} · ${config.timezone}` });
  return embed;
}

function leaderboardButtons(subjectId, page, rowCount) {
  const lastPage = Math.max(0, Math.ceil(rowCount / 10) - 1);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`login-time:page:${subjectId}:${Math.max(0, page - 1)}`)
      .setLabel('◀️ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`login-time:page:${subjectId}:${Math.min(lastPage, page + 1)}`)
      .setLabel('▶️ Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= lastPage)
  );
}

function confirmationButtons(userId, resetAll) {
  const action = resetAll ? 'confirm-all' : 'confirm-user';
  const confirmLabel = resetAll ? 'Confirm Reset' : 'Confirm';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`login-time:${action}:${userId}`).setLabel(confirmLabel).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`login-time:cancel:${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );
}

async function respond(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

function requireServerAdministrator(interaction) {
  if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    throw new Error('Administrator permission in a server is required.');
  }
}

export async function handleLoginTimeCommand(interaction, now = Date.now()) {
  const action = interaction.options.getSubcommand();
  const userId = interaction.user.id;
  const week = getLoginWeek(now);

  if (action === 'in') {
    if (!startLoginSession(userId, now)) {
      await respond(interaction, { content: '❌ You are already logged in.' });
      return true;
    }
    await respond(interaction, { content: `✅ You are now logged in. 🕐 Started: ${formatLocalTimestamp(now)}` });
    return true;
  }

  if (action === 'out') {
    const session = finishLoginSession(userId, now, splitDurationByWeek);
    if (!session) {
      await respond(interaction, { content: '❌ You are not currently logged in.' });
      return true;
    }
    await respond(interaction, {
      content: `✅ You are now logged out. 🕐 Session: ${formatDuration(now - session.started_at)} ⏱️ Total this week: ${formatDuration(getLoginWeeklyTotal(userId, week.id))}`
    });
    return true;
  }

  if (action === 'time') {
    const session = getLoginSession(userId);
    const activeText = session
      ? `🟢 Current session: ${formatDuration(now - session.started_at)} (started ${formatLocalTimestamp(session.started_at)})`
      : '⚪ Current session: Not logged in';
    await respond(interaction, {
      embeds: [new EmbedBuilder()
        .setTitle(`📊 Login Time — ${interaction.user}`)
        .setDescription(`📅 Week: ${formatWeek(week)}\n\n⏱️ Total this week: **${formatDuration(currentWeekTotal(userId, week, now))}**\n\n${activeText}`)
        .setColor(0x5865f2)
        .setFooter({ text: `Timezone: ${config.timezone}` })]
    });
    return true;
  }

  if (action === 'leaderboard') {
    const rows = leaderboardRows(week, now);
    await respond(interaction, {
      embeds: [leaderboardEmbed(week, rows, 0)],
      components: [leaderboardButtons(userId, 0, rows.length)]
    });
    return true;
  }

  if (action === 'reset') {
    const resetAll = interaction.options.getBoolean('all') === true;
    if (resetAll) requireServerAdministrator(interaction);
    await respond(interaction, {
      content: resetAll
        ? '⚠️ This will reset the current week’s login totals for ALL users. Continue?'
        : '⚠️ Are you sure you want to reset your login time for this week?',
      components: [confirmationButtons(userId, resetAll)]
    });
    return true;
  }

  throw new Error(`Unknown /log subcommand: ${action}.`);
}

export async function handleLoginTimeButton(interaction, now = Date.now()) {
  const [, action, subjectId, pageText] = interaction.customId.split(':');
  if (action === 'page') {
    const page = Number(pageText);
    if (!Number.isSafeInteger(page) || page < 0) throw new Error('Invalid leaderboard page.');
    const week = getLoginWeek(now);
    const rows = leaderboardRows(week, now);
    const boundedPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 10) - 1));
    await interaction.update({
      embeds: [leaderboardEmbed(week, rows, boundedPage)],
      components: [leaderboardButtons(subjectId, boundedPage, rows.length)]
    });
    return true;
  }

  if (action === 'cancel') {
    if (interaction.user.id !== subjectId) {
      throw new Error('Only the user who requested this reset can cancel it.');
    }
    await interaction.update({ content: 'Reset cancelled.', components: [] });
    return true;
  }

  if (action === 'confirm-user' || action === 'confirm-all') {
    if (action === 'confirm-all') requireServerAdministrator(interaction);
    else if (interaction.user.id !== subjectId) {
      throw new Error('Only the user who requested this reset can confirm it.');
    }
    const week = getLoginWeek(now);
    if (action === 'confirm-all') resetAllLoginWeekly(week.id, now, splitDurationByWeek);
    else resetLoginWeekly(subjectId, week.id, now, splitDurationByWeek);
    await interaction.update({
      content: action === 'confirm-all'
        ? '✅ This week’s login totals have been reset for everyone.'
        : '✅ Your login time for this week has been reset.',
      components: []
    });
    return true;
  }

  throw new Error(`Unknown login-time button action: ${action}.`);
}
