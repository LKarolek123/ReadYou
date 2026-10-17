/**
 * Publiczny wypis z raportu: token z e-maila, bez logowania i bez dostępu do profilu.
 * GET pokazuje stronę z przyciskiem (skanery linków w poczcie nie wypisują nikogo samym otwarciem),
 * POST wypisuje — także jednym kliknięciem z klienta poczty (RFC 8058, List-Unsubscribe-Post).
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../env.ts';
import { unsubscribeByToken } from '../engine/report.ts';

const query = z.object({ token: z.string().max(200).default('') });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(title: string, body: string) {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} — ReadYou</title>
<style>body{margin:0;background:#F8FAFC;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0F172A;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
main{max-width:440px;background:#fff;border:1px solid #E2E8F0;border-radius:20px;padding:28px}h1{font-size:22px;margin:8px 0 12px}p{line-height:1.6;color:#334155}
button,a.btn{display:inline-block;min-height:44px;padding:12px 20px;border:0;border-radius:12px;background:linear-gradient(90deg,#7C3AED,#2563EB);color:#fff;font-weight:600;font-size:15px;cursor:pointer;text-decoration:none}
.brand{color:#7C3AED;font-weight:700}</style></head><body><main><p class="brand">ReadYou</p><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

export const unsubscribeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/unsubscribe', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { token } = query.parse(request.query);
    reply.type('text/html; charset=utf-8').header('referrer-policy', 'no-referrer');
    return page(
      'Wypisać się z raportu?',
      `<p>Przestaniemy wysyłać piątkowy raport ReadYou na Twój adres. Konto i zapisane artykuły zostaną bez zmian.</p>
       <form method="post" action="/api/unsubscribe?token=${encodeURIComponent(token)}"><button type="submit">Wypisz mnie</button></form>`,
    );
  });

  app.post('/unsubscribe', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { token } = query.parse(request.query);
    const ok = await unsubscribeByToken(token);
    reply.type('text/html; charset=utf-8').header('referrer-policy', 'no-referrer');
    if (!ok) return reply.status(404).send(page('Link jest nieważny', '<p>Nie rozpoznaliśmy tego linku. Raport możesz wyłączyć w Profilu aplikacji.</p>'));
    return page(
      'Wypisano z raportu',
      `<p>Nie będziemy już wysyłać raportu tygodniowego. Możesz go ponownie włączyć w Profilu.</p><p><a class="btn" href="${esc(env.APP_URL)}/profile">Otwórz ustawienia</a></p>`,
    );
  });
};
