import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

const databaseDirectory = path.dirname(path.resolve(config.databasePath));
fs.mkdirSync(databaseDirectory, { recursive: true });
if (config.databasePath !== ':memory:' && path.resolve(config.databasePath) === path.resolve(config.legacyDatabasePath)) {
  throw new Error('DATABASE_PATH must not point to the preserved economy database archive.');
}

const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS login_time_sessions (
    user_id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    accounting_since_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_time_weekly (
    user_id TEXT NOT NULL,
    week_id TEXT NOT NULL,
    total_ms INTEGER NOT NULL DEFAULT 0 CHECK (total_ms >= 0),
    PRIMARY KEY (user_id, week_id)
  );
  CREATE TABLE IF NOT EXISTS user_wallet_addresses (
    user_id TEXT NOT NULL,
    asset TEXT NOT NULL,
    network TEXT NOT NULL,
    address TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, asset, network)
  );
  CREATE TABLE IF NOT EXISTS database_migrations (
    migration_id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );
`);

function migrateLoginTimeArchive() {
  const archivePath = path.resolve(config.legacyDatabasePath);
  if (!fs.existsSync(archivePath)) return;
  if (db.prepare('SELECT 1 FROM database_migrations WHERE migration_id = ?').get('login-time-archive-v1')) return;

  const archive = new Database(archivePath, { readonly: true, fileMustExist: true });
  try {
    const tables = new Set(archive.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    if (!tables.has('login_time_sessions') || !tables.has('login_time_weekly')) {
      throw new Error(`The login-time archive at ${archivePath} is missing expected tables.`);
    }

    const sessions = archive.prepare('SELECT user_id, started_at, accounting_since_at FROM login_time_sessions').all();
    const weekly = archive.prepare('SELECT user_id, week_id, total_ms FROM login_time_weekly').all();
    const migrate = db.transaction(() => {
      const insertSession = db.prepare(`
        INSERT INTO login_time_sessions (user_id, started_at, accounting_since_at)
        VALUES (@user_id, @started_at, @accounting_since_at)
        ON CONFLICT(user_id) DO NOTHING
      `);
      const insertWeekly = db.prepare(`
        INSERT INTO login_time_weekly (user_id, week_id, total_ms)
        VALUES (@user_id, @week_id, @total_ms)
        ON CONFLICT(user_id, week_id) DO NOTHING
      `);
      for (const session of sessions) insertSession.run(session);
      for (const total of weekly) insertWeekly.run(total);
      db.prepare('INSERT INTO database_migrations (migration_id, applied_at) VALUES (?, ?)').run('login-time-archive-v1', Date.now());
    });
    migrate();
  } finally {
    archive.close();
  }
}

migrateLoginTimeArchive();

export function getWalletAddresses(userId) {
  return db.prepare(`
    SELECT asset, network, address
    FROM user_wallet_addresses
    WHERE user_id = ?
    ORDER BY asset, network
  `).all(userId);
}

export function setWalletAddress(userId, asset, network, address) {
  db.prepare(`
    INSERT INTO user_wallet_addresses (user_id, asset, network, address, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, asset, network)
    DO UPDATE SET address = excluded.address, updated_at = excluded.updated_at
  `).run(userId, asset, network, address, Date.now());
}

export function removeWalletAddress(userId, asset, network) {
  return db.prepare('DELETE FROM user_wallet_addresses WHERE user_id = ? AND asset = ? AND network = ?')
    .run(userId, asset, network).changes > 0;
}

export function getLoginSession(userId) {
  return db.prepare('SELECT started_at, accounting_since_at FROM login_time_sessions WHERE user_id = ?').get(userId) || null;
}

export function getLoginWeeklyTotal(userId, weekId) {
  return db.prepare('SELECT total_ms FROM login_time_weekly WHERE user_id = ? AND week_id = ?').get(userId, weekId)?.total_ms || 0;
}

export function listLoginTimeUsers() {
  return db.prepare(`
    SELECT user_id FROM login_time_weekly
    UNION
    SELECT user_id FROM login_time_sessions
    ORDER BY user_id
  `).all().map((row) => row.user_id);
}

function addLoginTimeSegments(userId, segments) {
  const insert = db.prepare(`
    INSERT INTO login_time_weekly (user_id, week_id, total_ms) VALUES (?, ?, ?)
    ON CONFLICT(user_id, week_id) DO UPDATE SET total_ms = total_ms + excluded.total_ms
  `);
  for (const { weekId, durationMs } of segments) {
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) throw new Error('Login time segment must be a non-negative whole number of milliseconds.');
    if (durationMs > 0) insert.run(userId, weekId, durationMs);
  }
}

export const startLoginSession = db.transaction((userId, timestamp) => {
  const result = db.prepare(`
    INSERT INTO login_time_sessions (user_id, started_at, accounting_since_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId, timestamp, timestamp);
  return result.changes === 1;
});

export const finishLoginSession = db.transaction((userId, timestamp, splitRange) => {
  const session = getLoginSession(userId);
  if (!session) return null;
  addLoginTimeSegments(userId, splitRange(session.accounting_since_at, timestamp));
  db.prepare('DELETE FROM login_time_sessions WHERE user_id = ?').run(userId);
  return session;
});

export const resetLoginWeekly = db.transaction((userId, weekId, timestamp, splitRange) => {
  const session = getLoginSession(userId);
  if (session) {
    addLoginTimeSegments(userId, splitRange(session.accounting_since_at, timestamp)
      .filter((segment) => segment.weekId !== weekId));
    db.prepare('UPDATE login_time_sessions SET accounting_since_at = ? WHERE user_id = ?').run(timestamp, userId);
  }
  db.prepare(`
    INSERT INTO login_time_weekly (user_id, week_id, total_ms) VALUES (?, ?, 0)
    ON CONFLICT(user_id, week_id) DO UPDATE SET total_ms = 0
  `).run(userId, weekId);
});

export const resetAllLoginWeekly = db.transaction((weekId, timestamp, splitRange) => {
  const sessions = db.prepare('SELECT user_id, accounting_since_at FROM login_time_sessions').all();
  for (const session of sessions) {
    addLoginTimeSegments(session.user_id, splitRange(session.accounting_since_at, timestamp)
      .filter((segment) => segment.weekId !== weekId));
  }
  db.prepare('UPDATE login_time_sessions SET accounting_since_at = ?').run(timestamp);
  db.prepare('UPDATE login_time_weekly SET total_ms = 0 WHERE week_id = ?').run(weekId);
});

export function close() {
  db.close();
}
