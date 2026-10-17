/**
 * Raport tygodniowy: harmonogram (piątek 20:00, zmiana czasu), dobór pozycji, idempotencja generacji
 * i wysyłki, niepewny wynik, wypis, izolacja kont. Wysyłka przez atrapę dostawcy (bez sieci).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { EmailMessage, EmailProvider } from '../src/email/provider.ts';
import type { ReportSynthesizer } from '@readyou/providers';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  /* zmienne mogą pochodzić z CI */
}
process.env.NODE_ENV = 'test';
process.env.EMAIL_PROVIDER = 'disabled';

const { reportPeriod, generateReport, sendReport, scheduleReports, unsubscribeToken, REPORT_JOBS } = await import('../src/engine/report.ts');
const { sanitizeSynthesis } = await import('@readyou/providers');
const { setEmailProviderForTests } = await import('../src/email/provider.ts');
const { reportEmail } = await import('../src/email/report-template.ts');

/** Atrapa dostawcy: zapisuje wiadomości albo rzuca zadany błąd. */
class FakeEmail implements EmailProvider {
  readonly name = 'fake';
  readonly deliversToRealRecipients = false;
  sent: EmailMessage[] = [];
  fail: (Error & { code?: string; command?: string }) | null = null;
  async send(m: EmailMessage) {
    await new Promise((r) => setTimeout(r, 20));
    if (this.fail) throw this.fail;
    this.sent.push(m);
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}
const fake = new FakeEmail();

const synth: ReportSynthesizer = {
  model: 'fake-synth',
  async synthesize(items) {
    return {
      synthesis: sanitizeSynthesis({ intro: 'Tydzień pełen szachów.', changes: [{ text: 'Nowy mistrz turnieju.', item_ids: [items[0]!.id] }, { text: 'Zmyślona pozycja.', item_ids: ['p99'] }] }, new Set(items.map((i) => i.id))),
      usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  },
};

describe('okres i harmonogram', () => {
  it('okres = tydzień ISO terminu w strefie osoby; etykieta po polsku', () => {
    const p = reportPeriod(new Date('2026-10-23T18:00:00Z'), 'Europe/Warsaw'); // piątek 20:00 CEST
    expect(p.key).toBe('2026-W43');
    expect(p.label).toBe('16 października – 23 października 2026');
    expect(p.start.toISOString()).toBe('2026-10-16T18:00:00.000Z');
  });

  it('synteza: zdania bez pozycji z raportu są odrzucane', () => {
    const s = sanitizeSynthesis({ intro: ' Wstęp ', changes: [{ text: 'A', item_ids: ['p1'] }, { text: 'B', item_ids: ['p7'] }, { text: 'A2', item_ids: ['p1'] }] }, new Set(['p1', 'p2']));
    expect(s).toEqual({ intro: 'Wstęp', changes: [{ text: 'A', item_ids: ['p1'] }] });
  });

  it('szablon: polski temat, link do źródła każdej pozycji, wypis i ustawienia; HTML escapowany', () => {
    const e = reportEmail(
      { intro: 'Wstęp <b>', changes: [], periodLabel: '16–23 października', items: [{ contentId: 'x', section: 'news', title: 'Tytuł & <script>', description: null, url: 'https://src.example/a', source: 'Źródło', publishedAt: null, why: 'Polubione' }] },
      { appUrl: 'http://app', settingsUrl: 'http://app/profile', unsubscribeUrl: 'http://app/api/unsubscribe?token=t', timezone: 'Europe/Warsaw' },
    );
    expect(e.subject).toContain('Twój tydzień');
    expect(e.html).toContain('https://src.example/a');
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('Wypisz się');
    expect(e.text).toContain('Wypisz się: http://app/api/unsubscribe?token=t');
    expect(e.text).not.toMatch(/przeczytał|polubił|statystyk/i);
  });
});

describe('raport przez bazę i API', () => {
  const ORIGIN = 'http://localhost:5173';
  const host = `rep-${randomUUID().slice(0, 8)}.example`;
  let app: FastifyInstance;
  let db: typeof import('../src/db.ts').db;
  const users: { cookie: string; id: string; email: string }[] = [];
  const ids: string[] = [];
  const NOW = new Date();

  const call = (u: { cookie: string }, method: 'GET' | 'PUT' | 'PATCH' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { cookie: u.cookie, origin: ORIGIN, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: payload as object | undefined });

  beforeAll(async () => {
    const { buildServer } = await import('../src/server.ts');
    ({ db } = await import('../src/db.ts'));
    const { sql } = await import('kysely');
    app = await buildServer();
    setEmailProviderForTests(fake);
    for (let i = 0; i < 2; i++) {
      const email = `r-${randomUUID()}@example.com`;
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        payload: { name: 'Test', email, password: 'testowehaslo123' },
      });
      const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
      const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
      users.push({ cookie, id: me.json().user.id, email });
    }
    // Pięć artykułów ze streszczeniami; dwa to ta sama historia (identyczny wektor).
    const base = Array.from({ length: 384 }, (_, k) => (k === 0 ? 1 : 0));
    for (let i = 0; i < 5; i++) {
      const row = await db
        .insertInto('content_item')
        .values({ canonical_url: `https://${host}/${i}`, url: `https://${host}/${i}`, source_domain: host, source_name: 'Portal', title: `Szachy ${i}`, discovered_via: 'feed', status: 'extracted', published_at: NOW, created_at: NOW, updated_at: NOW })
        .returning('id')
        .executeTakeFirstOrThrow();
      ids.push(row.id);
      const v = i === 1 ? base : Array.from({ length: 384 }, (_, k) => (k === i + 1 ? 1 : 0));
      await sql`insert into content_embedding (content_id, model, dim, source_hash, embedding) values (${row.id}, 'test', 384, 'x', ${`[${(i === 0 ? base : v).join(',')}]`}::vector)`.execute(db);
      await db.insertInto('summary').values({ content_id: row.id, source_hash: 'h', prompt_version: 't', model: 't', sufficient: true, card_description: `Opis ${i}`, summary: `Streszczenie ${i}`, key_facts: '["fakt"]', caveats: '[]', basis: 'full', created_at: NOW }).execute();
    }
    const a = users[0]!;
    // 0 i 1: ta sama historia, oba polubione; 2: polubiony i przeczytany; 3: pominięty; 4: polubiony.
    for (const i of [0, 1, 4]) await call(a, 'PUT', `/api/me/content/${ids[i]}/state`, { liked: true });
    await call(a, 'PUT', `/api/me/content/${ids[2]}/state`, { liked: true, read: true });
    await call(a, 'PUT', `/api/me/content/${ids[3]}/state`, { liked: true, skipped: true });
  });

  beforeEach(() => {
    fake.sent = [];
    fake.fail = null;
  });

  afterAll(async () => {
    for (const u of users) await app.inject({ method: 'DELETE', url: '/api/me', headers: { cookie: u.cookie, origin: ORIGIN } });
    if (db) {
      await db.deleteFrom('job').where((eb) => eb.or(users.map((u) => eb('dedupe_key', 'like', `%${u.id}%`)))).execute();
      await db.deleteFrom('content_item').where('source_domain', '=', host).execute();
    }
    await app?.close();
    const { pool } = await import('../src/db.ts');
    await pool.end();
  });

  async function verifyAndSubscribe(u: { id: string; cookie: string }) {
    await db.updateTable('user').set({ emailVerified: true }).where('id', '=', u.id).execute();
    expect((await call(u, 'PATCH', '/api/me/report-subscription', { enabled: true })).statusCode).toBe(200);
  }
  const delivery = async (reportId: string) => db.selectFrom('email_delivery').selectAll().where('report_id', '=', reportId).executeTakeFirstOrThrow();

  it('generacja: polubione nieprzeczytane, bez przeczytanych i pominiętych, ta sama historia raz; synteza tylko ze źródłem', async () => {
    const a = users[0]!;
    await verifyAndSubscribe(a);
    const res = await generateReport(a.id, new Date(NOW.getTime() + 60_000), synth);
    expect(res).toMatchObject({ status: 'ready', synthesis: true });
    const report = await db.selectFrom('weekly_report').selectAll().where('id', '=', (res as { reportId: string }).reportId).executeTakeFirstOrThrow();
    const itemIds = report.content.items.map((i) => i.contentId);
    expect(itemIds).toContain(ids[4]);
    expect(itemIds.filter((id) => id === ids[0] || id === ids[1])).toHaveLength(1); // ta sama historia raz
    expect(itemIds).not.toContain(ids[2]); // przeczytany
    expect(itemIds).not.toContain(ids[3]); // pominięty
    expect(report.content.items.length).toBeLessThanOrEqual(10);
    expect(report.content.changes).toHaveLength(1); // zdanie bez pozycji odrzucone
    expect(report.content.intro).toBe('Tydzień pełen szachów.');
    expect((await delivery(report.id)).status).toBe('pending');
    // Ponowienie zadania: ten sam raport, jedna wysyłka.
    const again = await generateReport(a.id, new Date(NOW.getTime() + 60_000), synth);
    expect(again).toMatchObject({ reportId: report.id, existing: true });
    expect(await db.selectFrom('email_delivery').select('id').where('user_id', '=', a.id).execute()).toHaveLength(1);
    const job = await db.selectFrom('job').select(['run_at']).where('dedupe_key', '=', `${REPORT_JOBS.send}:${(await delivery(report.id)).id}`).executeTakeFirstOrThrow();
    expect(job.run_at.getTime()).toBe(NOW.getTime() + 60_000); // wysyłka na termin, nie od razu
  });

  it('wysyłka: równoległe zadania wysyłają raz; nagłówki wypisu; ponowne wywołanie nic nie wysyła', async () => {
    const a = users[0]!;
    const r = await db.selectFrom('weekly_report').select('id').where('user_id', '=', a.id).executeTakeFirstOrThrow();
    const d = await delivery(r.id);
    const results = await Promise.all([sendReport(d.id), sendReport(d.id), sendReport(d.id)]);
    expect(results.filter((x) => 'status' in x && x.status === 'sent')).toHaveLength(1);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.to).toBe(a.email);
    expect(fake.sent[0]!.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(fake.sent[0]!.idempotencyKey).toMatch(/^report:/);
    expect(await sendReport(d.id)).toMatchObject({ skipped: 'status sent' });
    expect(fake.sent).toHaveLength(1);
  });

  it('błąd przed przekazaniem = ponowienie; błąd w trakcie = wynik niepewny bez ponownej wysyłki', async () => {
    const a = users[0]!;
    const r = await db.selectFrom('weekly_report').select('id').where('user_id', '=', a.id).executeTakeFirstOrThrow();
    const d = await delivery(r.id);
    await db.updateTable('email_delivery').set({ status: 'pending' }).where('id', '=', d.id).execute();
    fake.fail = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    await expect(sendReport(d.id)).rejects.toThrow(/ponowienia/);
    expect((await delivery(r.id)).status).toBe('pending');
    fake.fail = Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT', command: 'DATA' });
    expect(await sendReport(d.id)).toMatchObject({ status: 'uncertain' });
    fake.fail = null;
    expect(await sendReport(d.id)).toMatchObject({ skipped: 'status uncertain' });
    expect(fake.sent).toHaveLength(0);
  });

  it('wysyłka zawieszona w „sending” po awarii procesu przechodzi w niepewną', async () => {
    const a = users[0]!;
    const r = await db.selectFrom('weekly_report').select('id').where('user_id', '=', a.id).executeTakeFirstOrThrow();
    await db.updateTable('email_delivery').set({ status: 'sending', updated_at: new Date(Date.now() - 60 * 60_000) }).where('report_id', '=', r.id).execute();
    await scheduleReports();
    expect((await delivery(r.id)).status).toBe('uncertain');
  });

  it('przed wysyłką ponowna kontrola: wypis, niezweryfikowany adres, zbyt duże opóźnienie', async () => {
    const a = users[0]!;
    const r = await db.selectFrom('weekly_report').select(['id', 'scheduled_for']).where('user_id', '=', a.id).executeTakeFirstOrThrow();
    const reset = () => db.updateTable('email_delivery').set({ status: 'pending' }).where('report_id', '=', r.id).execute();
    await reset();
    expect(await sendReport((await delivery(r.id)).id, new Date(r.scheduled_for.getTime() + 13 * 3_600_000))).toMatchObject({ status: 'skipped' });
    expect((await delivery(r.id)).last_error).toMatch(/opóźnienie/);
    await reset();
    await db.updateTable('user').set({ emailVerified: false }).where('id', '=', a.id).execute();
    expect(await sendReport((await delivery(r.id)).id)).toMatchObject({ status: 'skipped' });
    await db.updateTable('user').set({ emailVerified: true }).where('id', '=', a.id).execute();
    expect(fake.sent).toHaveLength(0);
  });

  it('wypis: strona z przyciskiem, POST bez Origin wypisuje; zły token = 404; brak dostępu do danych', async () => {
    const a = users[0]!;
    const token = unsubscribeToken(a.id);
    const page = await app.inject({ method: 'GET', url: `/api/unsubscribe?token=${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Wypisz mnie');
    expect(page.body).not.toContain(a.email);
    expect((await call(a, 'GET', '/api/me/report-subscription')).json().enabled).toBe(true); // samo otwarcie nie wypisuje
    const bad = await app.inject({ method: 'POST', url: '/api/unsubscribe?token=zly-token-zly-token-zly', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'List-Unsubscribe=One-Click' });
    expect(bad.statusCode).toBe(404);
    const ok = await app.inject({ method: 'POST', url: `/api/unsubscribe?token=${token}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'List-Unsubscribe=One-Click' });
    expect(ok.statusCode).toBe(200);
    expect((await call(a, 'GET', '/api/me/report-subscription')).json()).toMatchObject({ enabled: false, nextSendAt: null });
    expect(await scheduleReports(new Date(NOW.getTime() + 7 * 86_400_000))).toBe(0); // brak przyszłej wysyłki
  });

  it('archiwum: tylko własne raporty; pusty raport bez wysyłki', async () => {
    const [a, b] = users as [(typeof users)[0], (typeof users)[0]];
    const mine = (await call(a, 'GET', '/api/me/reports')).json();
    expect(mine).toHaveLength(1);
    expect((await call(a, 'GET', `/api/me/reports/${mine[0].id}`)).json().content.items.length).toBeGreaterThan(0);
    expect((await call(b, 'GET', `/api/me/reports/${mine[0].id}`)).statusCode).toBe(404);
    expect((await call(b, 'GET', '/api/me/reports')).json()).toHaveLength(0);
    await verifyAndSubscribe(b);
    // Okres sprzed jakichkolwiek treści w bazie — brak pozycji do polecenia.
    const empty = await generateReport(b.id, new Date('2020-01-03T19:00:00Z'), null);
    expect(empty).toMatchObject({ status: 'empty' });
    const d = await db.selectFrom('email_delivery').select(['status']).where('user_id', '=', b.id).executeTakeFirstOrThrow();
    expect(d.status).toBe('skipped');
    expect((await call(b, 'GET', '/api/me/export')).json().weeklyReports).toHaveLength(1);
  });

  it('harmonogram: piątek 20:00 lokalnie — zadanie w oknie godziny przed terminem, z deduplikacją', async () => {
    const b = users[1]!;
    const before = new Date('2026-10-30T18:30:00Z'); // piątek 30.10, 19:30 CET (po zmianie czasu)
    await db.updateTable('weekly_report').set({ period_key: 'x' }).where('user_id', '=', b.id).execute();
    await scheduleReports(before);
    await scheduleReports(before);
    const jobs = await db.selectFrom('job').select(['payload', 'run_at']).where('dedupe_key', '=', `${REPORT_JOBS.generate}:${b.id}:2026-W44`).execute();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toMatchObject({ scheduledFor: '2026-10-30T19:00:00.000Z' }); // 20:00 CET = 19:00 UTC
  });
});
