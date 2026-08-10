// PM2 process definition.
//
//   pm2 start ecosystem.config.js
//   pm2 save
module.exports = {
  apps: [
    {
      name: 'northgate-os',

      // index.js reads its command directory as fs.readdirSync("./commands"),
      // which resolves against cwd rather than the file's own directory. PM2
      // would otherwise inherit the cwd of whoever ran `pm2 start`, so this
      // pair has to stay together or the bot throws ENOENT on boot.
      cwd: '/home/westcliff7799/northgate-studios-bot/Northgate-OS',
      script: 'index.js',

      // A gateway connection is single-socket; cluster mode would mean two bots
      // answering the same interaction.
      exec_mode: 'fork',
      instances: 1,

      autorestart: true,
      // Back off rather than hammer Discord if the bot is crash-looping on a
      // gateway error. 1s, 2s, 4s ... capped by PM2 at 15s. Matters more here
      // than usual: every boot re-PUTs the slash commands to the REST API.
      exp_backoff_restart_delay: 1000,
      min_uptime: '30s',
      max_restarts: 15,
      max_memory_restart: '300M',

      // Source control is the deploy trigger, not the filesystem. Watching would
      // mean a full gateway reconnect per file save, and node_modules is checked
      // in here, so any npm activity would restart the bot too.
      watch: false,

      time: true,
      merge_logs: true,

      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
