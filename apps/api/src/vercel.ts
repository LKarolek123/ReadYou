/**
 * Wejście API dla Vercel Functions: ta sama aplikacja Fastify co `index.ts`, ale bez `listen` —
 * żądania z funkcji trafiają bezpośrednio do serwera HTTP Fastify.
 *
 * Worker (embeddingi e5, odkrywanie, raporty) NIE działa na Vercelu — to osobny, długo działający
 * proces (lokalnie albo na serwerze) podłączony do tej samej bazy.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildServer } from './server.ts';

const app = await buildServer();
await app.ready();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  app.server.emit('request', req, res);
}
