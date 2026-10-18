const path = require('node:path');

module.exports = {
  apps: [{
    name: 'visty-bot',
    script: 'src/index.js',
    cwd: __dirname,
    interpreter: process.execPath,
    env: {
      NODE_ENV: 'production'
    },
    autorestart: true,
    watch: false,
    exp_backoff_restart_delay: 1000,
    min_uptime: '30s',
    max_restarts: 10,
    max_memory_restart: '512M',
    kill_timeout: 10000,
    time: true,
    merge_logs: true
  }]
};