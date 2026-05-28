export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('./jobs/tracking-check');
    const { startBot } = await import('./lib/services/telegram');
    startScheduler();
    startBot();
  }
}
