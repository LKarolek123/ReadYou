/**
 * Trwała kolejka zadań na PostgreSQL (tabela `job`).
 *
 * - Pobieranie: `FOR UPDATE SKIP LOCKED`, więc kilka workerów nie weźmie tego samego zadania.
 * - Dzierżawa: `locked_until`; zadanie porzucone przez martwy proces wraca po wygaśnięciu.
 * - Deduplikacja: najwyżej jedno oczekujące zadanie o danym `dedupe_key`, a zadania o tym
 *   samym kluczu nie działają równolegle.
 * - Ponowienia: ograniczone (`max_attempts`), z rosnącym opóźnieniem i obsługą Retry-After.
 */
import { sql, type Kysely, type Selectable } from 'kysely';
import { db, type Database, type JobTable } from '../db.ts';

export type Job = Selectable<JobTable>;

export interface EnqueueOptions {
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

/** Wyjątek handlera: ponów później (np. Retry-After dostawcy), bez zużywania limitu prób ponad 1. */
export class RetryLaterError extends Error {
  constructor(
    message: string,
    public delayMs: number,
  ) {
    super(message);
  }
}

export async function enqueue(
  kind: string,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
  executor: Kysely<Database> = db,
): Promise<void> {
  await executor
    .insertInto('job')
    .values({
      kind,
      payload: JSON.stringify(payload),
      dedupe_key: opts.dedupeKey ?? null,
      run_at: opts.runAt ?? new Date(),
      max_attempts: opts.maxAttempts ?? 5,
    })
    // Zadanie o tym kluczu już czeka — nowe zlecenie zlewa się z nim.
    .onConflict((oc) => oc.column('dedupe_key').where('status', '=', 'queued').doNothing())
    .execute();
}

/** Bierze jedno gotowe zadanie (lub porzucone po wygaśnięciu dzierżawy) i blokuje je dla workera. */
export async function claim(workerId: string, leaseMs: number, kinds?: readonly string[]): Promise<Job | undefined> {
  const kindFilter = kinds?.length ? sql`and j.kind in (${sql.join(kinds)})` : sql``;
  const res = await sql<Job>`
    update job set
      status = 'running',
      attempts = attempts + 1,
      locked_by = ${workerId},
      locked_until = now() + ${`${leaseMs} milliseconds`}::interval,
      updated_at = now()
    where id = (
      select j.id from job j
      where (
          (j.status = 'queued' and j.run_at <= now())
          or (j.status = 'running' and j.locked_until < now() and j.attempts < j.max_attempts)
        )
        ${kindFilter}
        and not exists (
          select 1 from job r
          where r.dedupe_key = j.dedupe_key and r.id <> j.id
            and r.status = 'running' and r.locked_until >= now()
        )
      order by j.run_at, j.id
      limit 1
      for update skip locked
    )
    returning *`.execute(db);
  return res.rows[0];
}

export async function complete(job: Job, workerId: string): Promise<void> {
  await db
    .updateTable('job')
    .set({ status: 'done', locked_by: null, locked_until: null, last_error: null, finished_at: new Date(), updated_at: new Date() })
    .where('id', '=', job.id)
    .where('locked_by', '=', workerId)
    .execute();
}

/** Opóźnienie ponowienia: 30 s, 1 min, 2 min… do 1 h, z losowym rozrzutem ±20%. */
export function backoffMs(attempt: number): number {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 3_600_000);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export async function fail(job: Job, workerId: string, err: unknown): Promise<'retry' | 'failed'> {
  const message = sanitizeError(err);
  const retryLater = err instanceof RetryLaterError;
  const exhausted = job.attempts >= job.max_attempts && !retryLater;
  if (exhausted) {
    await db
      .updateTable('job')
      .set({ status: 'failed', locked_by: null, locked_until: null, last_error: message, finished_at: new Date(), updated_at: new Date() })
      .where('id', '=', job.id)
      .where('locked_by', '=', workerId)
      .execute();
    return 'failed';
  }
  const delay = retryLater ? err.delayMs : backoffMs(job.attempts);
  try {
    await db
      .updateTable('job')
      .set({
        status: 'queued',
        run_at: new Date(Date.now() + delay),
        locked_by: null,
        locked_until: null,
        last_error: message,
        updated_at: new Date(),
        // Retry-After nie zużywa próby: to limit dostawcy, a nie błąd zadania.
        ...(retryLater ? { attempts: sql<number>`attempts - 1` } : {}),
      })
      .where('id', '=', job.id)
      .where('locked_by', '=', workerId)
      .execute();
  } catch (e) {
    // Czeka już nowsze zadanie o tym samym kluczu — ono wykona tę pracę.
    if ((e as { code?: string }).code !== '23505') throw e;
    await complete(job, workerId);
  }
  return 'retry';
}

/**
 * Sprzątanie: oznacza jako nieudane zadania porzucone po wyczerpaniu prób
 * i usuwa stare zakończone. Nieudane zostają dłużej do diagnozy.
 */
export async function pruneJobs(): Promise<number> {
  await sql`
    update job set status = 'failed', locked_by = null, locked_until = null, finished_at = now(), updated_at = now(),
      last_error = coalesce(last_error, 'Dzierżawa wygasła po ostatniej próbie')
    where status = 'running' and locked_until < now() and attempts >= max_attempts`.execute(db);
  const res = await sql`
    delete from job
    where (status = 'done' and finished_at < now() - interval '7 days')
       or (status = 'failed' and finished_at < now() - interval '30 days')`.execute(db);
  return Number(res.numAffectedRows ?? 0);
}

/** Komunikat błędu bez sekretów: tylko treść, przycięta, z zamaskowanymi kluczami w URL-ach. */
function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/([?&](?:key|token|api[_-]?key|secret)=)[^&\s]+/gi, '$1***').slice(0, 1000);
}
