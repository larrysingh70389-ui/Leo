export function addCalendarMonths(date, months) {
  const source = new Date(date);
  if (!Number.isFinite(source.getTime())) return null;
  const targetMonthIndex = source.getUTCFullYear() * 12 + source.getUTCMonth() + months;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(source.getUTCDate(), new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate());
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds()
  ));
}

export function isUnderageAccount(accountCreatedAt, now = new Date()) {
  const validAt = addCalendarMonths(accountCreatedAt, 3);
  return !validAt || validAt > new Date(now);
}

function mentionsFor(checks, predicate) {
  const mentions = checks.filter(predicate).map(({ user }) => `<@${user.id}>`);
  return mentions.length ? mentions.join('\n') : 'None';
}

export function renderUserCheckReport(checks, verifiedRoleId) {
  const uniqueChecks = [...new Map(checks.map((check) => [check.user.id, check])).values()];
  const presenceOf = ({ member }) => member ? member.presence?.status || 'offline' : 'departed';
  const hasVerifiedRole = ({ member }) => Boolean(member?.roles?.cache?.has(verifiedRoleId));

  return [
    '🔎 User Check Report',
    '',
    `Users checked: ${uniqueChecks.length}`,
    '',
    '🟢 Online:',
    mentionsFor(uniqueChecks, (check) => presenceOf(check) === 'online'),
    '',
    '🌙 Idle:',
    mentionsFor(uniqueChecks, (check) => presenceOf(check) === 'idle'),
    '',
    '⛔ Do Not Disturb:',
    mentionsFor(uniqueChecks, (check) => presenceOf(check) === 'dnd'),
    '',
    '⚫ Offline:',
    mentionsFor(uniqueChecks, (check) => presenceOf(check) === 'offline'),
    '',
    '🚪 Left server:',
    mentionsFor(uniqueChecks, (check) => presenceOf(check) === 'departed'),
    '',
    '✅ Verified:',
    mentionsFor(uniqueChecks, hasVerifiedRole),
    '',
    '❌ Unverified:',
    mentionsFor(uniqueChecks, (check) => !hasVerifiedRole(check)),
    '',
    '🔴 Accounts under 3 months:',
    mentionsFor(uniqueChecks, (check) => check.underage)
  ].join('\n');
}