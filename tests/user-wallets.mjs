import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory = mkdtempSync(path.join(tmpdir(), 'leonidas-wallets-'));
const databasePath = path.join(directory, 'leonidas.sqlite');
const archivePath = path.join(directory, 'economy.sqlite');
let databaseModule;
const originalFetch = globalThis.fetch;
process.env.DISCORD_TOKEN ||= 'test-token';
process.env.DATABASE_PATH = databasePath;
process.env.ECONOMY_DATABASE_PATH = archivePath;

try {
  const archive = new Database(archivePath);
  archive.exec(`
    CREATE TABLE login_time_sessions (user_id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, accounting_since_at INTEGER NOT NULL);
    CREATE TABLE login_time_weekly (user_id TEXT, week_id TEXT, total_ms INTEGER, PRIMARY KEY (user_id, week_id));
    CREATE TABLE economy_users (user_id TEXT PRIMARY KEY, balance INTEGER NOT NULL);
    INSERT INTO login_time_sessions VALUES ('legacy-user', 100, 100);
    INSERT INTO login_time_weekly VALUES ('legacy-user', '2026-W01', 3600000);
    INSERT INTO economy_users VALUES ('economy-user', 500);
  `);
  archive.close();

  databaseModule = await import('../src/database.js');
  const wallets = await import('../src/user-wallets.js');
  assert.deepEqual(databaseModule.getLoginSession('legacy-user'), { started_at: 100, accounting_since_at: 100 });
  assert.equal(databaseModule.getLoginWeeklyTotal('legacy-user', '2026-W01'), 3600000);

  const archiveCheck = new Database(archivePath, { readonly: true });
  assert.equal(archiveCheck.prepare('SELECT balance FROM economy_users WHERE user_id = ?').get('economy-user').balance, 500);
  assert.equal(archiveCheck.prepare('SELECT COUNT(*) AS count FROM login_time_sessions').get().count, 1);
  archiveCheck.close();

  globalThis.fetch = async (input, options = {}) => {
    assert.match(String(input), /ethereum-rpc\.publicnode\.com/);
    assert.equal(options.method, 'POST');
    return new Response(JSON.stringify({ result: '0x0' }));
  };
  const address = '0x000000000000000000000000000000000000dEaD';
  await wallets.configureUserWallet('user-1', 'ethereum', 'ethereum', address);
  assert.deepEqual(wallets.getUserWallets('user-1'), [
    { asset: 'ethereum', network: 'ethereum', address }
  ]);
  assert.equal(wallets.formatWallets(wallets.getUserWallets('user-1')), `**ETHEREUM / ethereum**\n${address}`);

  const updatedAddress = '0x0000000000000000000000000000000000000001';
  await wallets.configureUserWallet('user-1', 'ethereum', 'ethereum', updatedAddress);
  assert.equal(wallets.getUserWallets('user-1').length, 1);
  assert.equal(wallets.getUserWallets('user-1')[0].address, updatedAddress);
  assert.equal(wallets.getUserWallets('another-user').length, 0);
  assert.equal(wallets.formatWallets([]), 'No public wallet addresses are configured.');

  await assert.rejects(
    wallets.configureUserWallet('user-1', 'ethereum', 'base', address),
    /not supported on base/
  );
  await assert.rejects(
    wallets.configureUserWallet('user-1', 'bitcoin', 'bitcoin', 'not-a-bitcoin-address'),
    /valid public address format/
  );
  assert.equal(wallets.deleteUserWallet('user-1', 'ethereum', 'ethereum'), true);
  assert.equal(wallets.deleteUserWallet('user-1', 'ethereum', 'ethereum'), false);

  const { handlePrefixCommand, handleSlashCommand } = await import('../src/prefix.js');
  const slashSetup = [];
  assert.equal(await handleSlashCommand({
    commandName: 'setup',
    user: { id: 'slash-user' },
    options: {
      getSubcommandGroup: () => 'wallet',
      getSubcommand: () => 'set',
      getString: (name) => ({ asset: 'usdc', network: 'ethereum', address }[name])
    },
    editReply: async (payload) => slashSetup.push(payload)
  }), true);
  assert.match(slashSetup[0], /Saved your public USDC address on ethereum/);
  assert.equal(wallets.getUserWallets('slash-user')[0].asset, 'usdc');

  const prefixReplies = [];
  assert.equal(await handlePrefixCommand({
    author: { id: 'prefix-user', username: 'Prefix User' },
    content: `+setup wallet set ethereum ethereum ${address}`,
    client: {},
    channel: {},
    mentions: { users: { get: () => null, first: () => null } },
    reply: async (payload) => prefixReplies.push(payload)
  }), true);
  assert.match(prefixReplies[0], /Saved your public ETHEREUM address/);
  const prefixWallets = [];
  assert.equal(await handlePrefixCommand({
    author: { id: 'prefix-user', username: 'Prefix User', toString: () => '<@prefix-user>' },
    content: '+wallets',
    client: {},
    channel: {},
    mentions: { users: { get: () => null, first: () => null } },
    reply: async (payload) => prefixWallets.push(payload)
  }), true);
  assert.match(prefixWallets[0], /Public wallets for <@prefix-user>/);
  assert.match(prefixWallets[0], new RegExp(address));

  const slashWallets = [];
  assert.equal(await handleSlashCommand({
    commandName: 'wallets',
    user: { id: 'prefix-user', username: 'Prefix User', toString: () => '<@prefix-user>' },
    options: { getUser: () => null },
    editReply: async (payload) => slashWallets.push(payload)
  }), true);
  assert.match(slashWallets[0], /Public wallets for <@prefix-user>/);
  assert.match(slashWallets[0], new RegExp(address));

  databaseModule.close();
  databaseModule = null;

  console.log('User wallet tests passed: persistence, update/remove, network validation, and read-only login migration.');
} finally {
  globalThis.fetch = originalFetch;
  databaseModule?.close();
  rmSync(directory, { recursive: true, force: true });
}
