import { app } from './app.js';
import { env } from './config/env.js';

const server = app.listen(env.PORT, env.HOST, () => {
  console.info(`API listening at http://${env.HOST}:${env.PORT}`);
});

server.on('error', (error) => {
  console.error('API failed to start:', error);
  process.exit(1);
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`${signal} received; closing the HTTP server.`);

  const timeout = setTimeout(() => {
    console.error('Shutdown timed out.');
    server.closeAllConnections();
    process.exit(1);
  }, 10_000);
  timeout.unref();

  server.close((error) => {
    clearTimeout(timeout);
    if (error) console.error('Shutdown failed:', error);
    process.exit(error ? 1 : 0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
