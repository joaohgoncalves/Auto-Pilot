import { buildApp } from './app.js';
import { env } from './config/env.js';

async function main() {
  const app = buildApp();
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
