import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { fromNodeHeaders } from 'better-auth/node';
import { sql } from 'kysely';
import { auth } from './auth.ts';
import { db } from './db.ts';
import { env, googleEnabled } from './env.ts';
import { emailProvider } from './email/provider.ts';
import { HttpError } from './http.ts';
import { profileRoutes } from './routes/profile.ts';
import { onboardingRoutes } from './routes/onboarding.ts';
import { interestRoutes } from './routes/interests.ts';
import { reportRoutes } from './routes/report.ts';
import { accountRoutes } from './routes/account.ts';
import { feedRoutes } from './routes/feed.ts';
import { unsubscribeRoutes } from './routes/unsubscribe.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildServer() {
  const app = Fastify({
    bodyLimit: 64 * 1024,
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
  });

  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  // Formularz wypisu i POST jednym kliknięciem (treść nieistotna — token jest w adresie).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 1024 }, (_req, body, done) => done(null, body));

  // CSRF: zmieniające żądania muszą pochodzić z naszego originu (ciasteczka SameSite=Lax + kontrola Origin).
  // Ścieżki Better Auth mają własną kontrolę trustedOrigins.
  const appOrigin = new URL(env.APP_URL).origin;
  app.addHook('onRequest', async (request) => {
    // Wypis z raportu: token z e-maila zamiast sesji, a klient poczty wysyła POST bez Origin (RFC 8058).
    if (SAFE_METHODS.has(request.method) || request.url.startsWith('/api/auth/') || request.url.startsWith('/api/unsubscribe')) return;
    const origin = request.headers.origin;
    if (origin !== appOrigin) throw new HttpError(403, 'CSRF', 'Niedozwolone źródło żądania');
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = err.statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
    request.log.error({ err: { message: err.message, stack: err.stack } }, 'unhandled');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Wystąpił błąd serwera' } });
  });

  // Better Auth (rejestracja, logowanie, Google, weryfikacja e-maila, reset hasła).
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const url = new URL(request.url, env.APP_URL);
      const res = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        }),
      );
      reply.status(res.status);
      res.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie') reply.header(key, value);
      });
      // Kilka ciasteczek musi trafić jako osobne nagłówki Set-Cookie.
      const cookies = res.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.send(res.body ? await res.text() : null);
    },
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/ready', async (_req, reply) => {
    try {
      await sql`select 1`.execute(db);
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'not-ready', reason: 'database' });
    }
  });

  // Publiczna konfiguracja dla UI — bez sekretów.
  app.get('/api/config', async () => ({
    googleEnabled,
    email: { provider: emailProvider.name, localCapture: !emailProvider.deliversToRealRecipients },
    contentEngine: (env.EMBEDDING_PROVIDER === 'e5-local' ? 'live' : 'not-configured') as 'live' | 'not-configured',
    summaries: Boolean(env.ANTHROPIC_API_KEY),
    search: Boolean(env.BRAVE_SEARCH_SECRET_KEY),
  }));

  await app.register(profileRoutes, { prefix: '/api' });
  await app.register(onboardingRoutes, { prefix: '/api' });
  await app.register(interestRoutes, { prefix: '/api' });
  await app.register(reportRoutes, { prefix: '/api' });
  await app.register(accountRoutes, { prefix: '/api' });
  await app.register(feedRoutes, { prefix: '/api' });
  await app.register(unsubscribeRoutes, { prefix: '/api' });

  return app;
}
