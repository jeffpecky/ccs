import { startServer } from './web-server';

const port = parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || 'localhost';

startServer({ port, host }).then(() => {
  console.log(`Dashboard running at http://${host}:${port}`);
}).catch((err) => {
  console.error('Failed to start dashboard:', err);
  process.exit(1);
});
