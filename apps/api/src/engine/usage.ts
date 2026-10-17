/**
 * Twarde limity płatnych dostawców. Rezerwacja wywołania jest atomowa (blokada doradcza w transakcji),
 * więc kilka workerów nie przekroczy limitu dziennego ani miesięcznego.
 * Po przekroczeniu nowe płatne wywołania są wstrzymane; odczyt zapisanych treści działa dalej.
 */
import { sql } from 'kysely';
import { db } from '../db.ts';

export interface Limits {
  daily: number;
  monthly: number;
}

export async function reserveCall(provider: string, limits: Limits): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`provider_usage:${provider}`}))`.execute(trx);
    const usage = await sql<{ today: number; month: number }>`
      select
        coalesce(sum(calls) filter (where day = (now() at time zone 'utc')::date), 0)::int as today,
        coalesce(sum(calls), 0)::int as month
      from provider_usage
      where provider = ${provider} and day >= date_trunc('month', now() at time zone 'utc')::date`.execute(trx);
    const { today, month } = usage.rows[0]!;
    if (today >= limits.daily || month >= limits.monthly) return false;
    await sql`
      insert into provider_usage (day, provider, calls) values ((now() at time zone 'utc')::date, ${provider}, 1)
      on conflict (day, provider) do update set calls = provider_usage.calls + 1`.execute(trx);
    return true;
  });
}

export async function usageSummary(provider: string) {
  const r = await sql<{ today: number; month: number }>`
    select
      coalesce(sum(calls) filter (where day = (now() at time zone 'utc')::date), 0)::int as today,
      coalesce(sum(calls), 0)::int as month
    from provider_usage
    where provider = ${provider} and day >= date_trunc('month', now() at time zone 'utc')::date`.execute(db);
  return r.rows[0]!;
}
