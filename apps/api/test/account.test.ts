/**
 * Testy integracyjne API na lokalnej bazie (docker compose up -d && npm run db:migrate).
 * Tworzą tymczasowe konta i usuwają je po zakończeniu.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  /* zmienne mogą pochodzić z CI */
}
process.env.NODE_ENV = 'test';
process.env.EMAIL_PROVIDER = 'disabled';

let app: FastifyInstance;
const ORIGIN = 'http://localhost:5173';

async function signUp(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    payload: { name: 'Test', email: `t-${randomUUID()}@example.com`, password: 'testowehaslo123' },
  });
  expect(res.statusCode).toBe(200);
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

const call = (cookie: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: { cookie, origin: ORIGIN, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) },
    payload: payload as object | undefined,
  });

let a: string;
let b: string;

beforeAll(async () => {
  const { buildServer } = await import('../src/server.ts');
  app = await buildServer();
  a = await signUp();
  b = await signUp();
});

afterAll(async () => {
  for (const c of [a, b]) if (c) await call(c, 'DELETE', '/api/me');
  await app?.close();
  const { pool } = await import('../src/db.ts');
  await pool.end();
});

describe('izolacja kont', () => {
  it('użytkownik A nie widzi ani nie zmienia tagów B', async () => {
    const created = await call(b, 'POST', '/api/me/interests', { label: 'Szachy' });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    expect((await call(a, 'GET', '/api/me/interests')).json()).toEqual([]);
    expect((await call(a, 'PATCH', `/api/me/interests/${id}`, { state: 'excluded' })).statusCode).toBe(404);
    expect((await call(a, 'DELETE', `/api/me/interests/${id}`)).statusCode).toBe(404);

    const exportA = (await call(a, 'GET', '/api/me/export')).json();
    expect(exportA.interests).toEqual([]);
    expect((await call(b, 'GET', '/api/me/interests')).json()).toHaveLength(1);
  });

  it('bez sesji API zwraca 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
  });

  it('odrzuca zmiany z obcego originu (CSRF)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { cookie: a, origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: { city: 'X' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('tagi i profil', () => {
  it('wykluczenie nadpisuje stan tagu, a reset wyuczonych go nie rusza', async () => {
    await call(a, 'POST', '/api/me/interests', { label: 'Alpy' });
    const ex = await call(a, 'POST', '/api/me/interests', { label: 'alpy', state: 'excluded' });
    expect(ex.json()).toMatchObject({ label: 'Alpy', state: 'excluded', path: ['Góry i outdoor', 'Pasma górskie', 'Alpy'] });
    await call(a, 'POST', '/api/me/interests/reset-learned');
    const list = (await call(a, 'GET', '/api/me/interests')).json();
    expect(list.filter((i: { normalized: string }) => i.normalized === 'alpy')).toHaveLength(1);
    expect(list[0].state).toBe('excluded');
  });

  it('wieloznaczny tag wymaga doprecyzowania', async () => {
    const res = await call(a, 'POST', '/api/me/interests', { label: 'Tesla' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('AMBIGUOUS');
  });

  it('budżet: „nie wiem” (null) różni się od „tylko bezpłatne” (0)', async () => {
    const r1 = await call(a, 'PATCH', '/api/me/profile', { budget: { currency: 'PLN', maxEventPrice: 0 } });
    expect(r1.json().budget.maxEventPrice).toBe(0);
    const r2 = await call(a, 'PATCH', '/api/me/profile', { budget: { currency: 'PLN', maxEventPrice: null } });
    expect(r2.json().budget.maxEventPrice).toBeNull();
  });

  it('raportu nie da się włączyć bez potwierdzonego e-maila', async () => {
    const res = await call(a, 'PATCH', '/api/me/report-subscription', { enabled: true });
    expect(res.statusCode).toBe(409);
  });

  it('onboarding DFS zapisuje wybory jako jawne tagi z zachowaniem ścieżek', async () => {
    await call(b, 'POST', '/api/onboarding/next', { action: 'start', rootIds: ['tech'] });
    await call(b, 'POST', '/api/onboarding/next', { action: 'answer', optionIds: ['tech.ai'] });
    const v = (await call(b, 'POST', '/api/onboarding/next', { action: 'enough' })).json();
    expect(v.dfsDone).toBe(true);
    await call(b, 'POST', '/api/onboarding/step', { step: 'tags' });
    const tags = (await call(b, 'GET', '/api/me/interests')).json() as { label: string; origin: string }[];
    expect(tags.map((t) => t.label)).toEqual(expect.arrayContaining(['Informatyka i technologia', 'Sztuczna inteligencja', 'Szachy']));
    // Ręcznie dodane „Szachy” zostają nietknięte przez materializację onboardingu.
    expect(tags.find((t) => t.label === 'Szachy')?.origin).toBe('manual');
  });
});
