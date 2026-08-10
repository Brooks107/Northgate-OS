module.exports = {
  apps: [
    {
      name: 'northgate-os',

      cwd: '/home/westcliff7799/northgate-studios-bot/Northgate-OS',
      script: 'index.js',

      exec_mode: 'fork',
      instances: 1,

      autorestart: true,
      exp_backoff_restart_delay: 1000,
      min_uptime: '30s',
      max_restarts: 15,
      max_memory_restart: '300M',

      watch: false,

      time: true,
      merge_logs: true,

      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
