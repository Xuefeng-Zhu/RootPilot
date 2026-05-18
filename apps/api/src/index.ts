import { buildApp } from './server.js';

const PORT = parseInt(process.env['API_PORT'] ?? '4000', 10);
const HOST = process.env['API_HOST'] ?? '0.0.0.0';

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`RootPilot API listening on ${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
