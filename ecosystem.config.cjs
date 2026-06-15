module.exports = {
  apps: [
    {
      name: 'package-tracker',
      cwd: '/root/apps/package-tracker',
      script: 'npm',
      args: 'run dev',
      env: {
        NODE_ENV: 'development',
        PORT: 3013,
      },
      max_restarts: 5,
      restart_delay: 3000,
    },
  ],
};
