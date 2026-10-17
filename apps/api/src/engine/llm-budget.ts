/**
 * Twardy budżet kosztu LLM. Przed wywołaniem rezerwujemy szacowany koszt (górne oszacowanie),
 * po wywołaniu zamieniamy rezerwację na rzeczywiste zużycie tokenów. Blokada doradcza
 * w transakcji chroni limit przy równoległych zadaniach.
 *
 * Kwoty w USD to SZACUNEK ze stawek w konfiguracji (LLM_*_USD_PER_MTOK), nie faktura dostawcy.
 */
import { sql } from 'kysely';
import { db } from '../db.ts';
import { env } from '../env.ts';

const day = sql`(now() at time zone 'utc')::date`;

export function estimateCostUsd(inputTokens: number, outputTokens: number) {
  return (inputTokens * env.LLM_INPUT_USD_PER_MTOK + outputTokens * env.LLM_OUTPUT_USD_PER_MTOK) / 1_000_000;
}

/** Rezerwuje `usd` w budżecie dziennym i miesięcznym; false = limit wyczerpany. */
export async function reserveLlm(model: string, usd: number): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext('llm_usage'))`.execute(trx);
    const r = await sql<{ today: number; month: number }>`
      select
        coalesce(sum(est_cost_usd + reserved_usd) filter (where day = ${day}), 0)::float8 as today,
        coalesce(sum(est_cost_usd + reserved_usd), 0)::float8 as month
      from llm_usage where day >= date_trunc('month', now() at time zone 'utc')::date`.execute(trx);
    const { today, month } = r.rows[0]!;
    if (today + usd > env.LLM_DAILY_BUDGET_USD || month + usd > env.LLM_MONTHLY_BUDGET_USD) return false;
    await sql`
      insert into llm_usage (day, model, reserved_usd) values (${day}, ${model}, ${usd})
      on conflict (day, model) do update set reserved_usd = llm_usage.reserved_usd + excluded.reserved_usd`.execute(trx);
    return true;
  });
}

/** Rozlicza rezerwację: zdejmuje szacunek i dopisuje rzeczywiste zużycie (lub tylko zwalnia przy błędzie). */
export async function settleLlm(
  model: string,
  reservedUsd: number,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } | null,
) {
  const cost = usage ? estimateCostUsd(usage.inputTokens + usage.cacheReadTokens * 0.1 + usage.cacheWriteTokens * 1.25, usage.outputTokens) : 0;
  await sql`
    update llm_usage set
      reserved_usd = greatest(reserved_usd - ${reservedUsd}, 0),
      requests = requests + ${usage ? 1 : 0},
      input_tokens = input_tokens + ${usage?.inputTokens ?? 0},
      output_tokens = output_tokens + ${usage?.outputTokens ?? 0},
      cache_read_tokens = cache_read_tokens + ${usage?.cacheReadTokens ?? 0},
      cache_write_tokens = cache_write_tokens + ${usage?.cacheWriteTokens ?? 0},
      est_cost_usd = est_cost_usd + ${cost}
    where day = ${day} and model = ${model}`.execute(db);
}

export async function llmSummary() {
  const r = await sql<{ today: number; month: number; requests: number }>`
    select
      coalesce(sum(est_cost_usd) filter (where day = ${day}), 0)::float8 as today,
      coalesce(sum(est_cost_usd), 0)::float8 as month,
      coalesce(sum(requests), 0)::int as requests
    from llm_usage where day >= date_trunc('month', now() at time zone 'utc')::date`.execute(db);
  return r.rows[0]!;
}
