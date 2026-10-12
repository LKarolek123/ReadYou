import { env } from './env.ts';
import { buildServer } from './server.ts';

const app = await buildServer();
await app.listen({ port: env.API_PORT, host: '127.0.0.1' });
