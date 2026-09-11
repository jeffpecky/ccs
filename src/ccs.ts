import { startServer } from './web-server';
import {
  DEFAULT_LOCAL_DASHBOARD_HOST,
  DEFAULT_LOCAL_DASHBOARD_PORT,
} from './web-server/server-defaults';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const { tryHandleRootCommand } = await import('./commands/root-command-router');
    if (await tryHandleRootCommand(args)) return;
  }

  const port = parseInt(process.env.PORT || String(DEFAULT_LOCAL_DASHBOARD_PORT), 10);
  const host = process.env.HOST || DEFAULT_LOCAL_DASHBOARD_HOST;

  await startServer({ port, host });
  console.log(`Dashboard running at http://${host}:${port}`);
}

main().catch((err) => {
  console.error('Failed to start dashboard:', err);
  process.exit(1);
});
