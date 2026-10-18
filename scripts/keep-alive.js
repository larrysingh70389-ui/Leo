import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const botEntry = path.join(projectRoot, 'src', 'index.js');
const initialRestartDelayMs = 5000;
const maxRestartDelayMs = 60000;
const stableRunMs = 5 * 60 * 1000;

let child;
let restartTimer;
let stopping = false;
let restartAttempts = 0;
let childStartedAt = 0;

function startBot() {
  if (stopping) return;

  console.log('Starting Discord bot...');
  childStartedAt = Date.now();
  child = spawn(process.execPath, [botEntry], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit'
  });

  child.once('error', (error) => {
    console.error(`Could not start the bot process: ${error.message}`);
  });

  child.once('exit', (code, signal) => {
    child = undefined;
    if (stopping) return;

    if (Date.now() - childStartedAt >= stableRunMs) restartAttempts = 0;
    const delayMs = Math.min(initialRestartDelayMs * (2 ** restartAttempts), maxRestartDelayMs);
    restartAttempts += 1;
    const result = signal ? `signal ${signal}` : `exit code ${code}`;
    console.error(`Bot stopped with ${result}. Restarting in ${delayMs / 1000} seconds.`);
    restartTimer = setTimeout(startBot, delayMs);
  });
}

function stopBot(signal) {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer);
  console.log(`Stopping bot supervisor (${signal}).`);

  if (!child) return;
  child.kill(signal);

  const forceStopTimer = setTimeout(() => child?.kill('SIGKILL'), 10000);
  forceStopTimer.unref();
  child.once('exit', () => clearTimeout(forceStopTimer));
}

process.once('SIGINT', () => stopBot('SIGINT'));
process.once('SIGTERM', () => stopBot('SIGTERM'));

startBot();