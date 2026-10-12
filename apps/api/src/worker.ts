/**
 * Worker zadań w tle: pobiera zadania z tabeli `job` i wykonuje je po jednym
 * (embeddingi liczone są na CPU, więc równoległość w jednym procesie nic nie daje).
 * Można uruchomić kilka workerów — kolejka gwarantuje, że nie wezmą tego samego zadania.
 */
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { pool } from './db.ts';
import { env } from './env.ts';
import { handlers } from './jobs/handlers.ts';
import { claim, complete, fail, pruneJobs } from './jobs/queue.ts';

const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const LEASE_MS = 5 * 60_000;
const PRUNE_EVERY_MS = 60 * 60_000;

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1);
    stopping = true;
    log('info', 'Zatrzymywanie po bieżącym zadaniu…');
  });
}

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), level, worker: workerId, msg, ...extra }));
}

async function main() {
  log('info', 'Worker uruchomiony', { kinds: Object.keys(handlers) });
  let lastPrune = 0;
  while (!stopping) {
    if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
      lastPrune = Date.now();
      const pruned = await pruneJobs().catch((e: Error) => (log('warn', 'Sprzątanie nieudane', { error: e.message }), 0));
      if (pruned) log('info', 'Usunięto stare zadania', { pruned });
    }

    const job = await claim(workerId, LEASE_MS, Object.keys(handlers)).catch((e: Error) => {
      log('error', 'Błąd pobierania zadania', { error: e.message });
      return undefined;
    });
    if (!job) {
      await sleep(env.WORKER_POLL_MS);
      continue;
    }

    const started = Date.now();
    try {
      const result = await handlers[job.kind]!(job);
      await complete(job, workerId);
      log('info', 'Zadanie wykonane', { id: job.id, kind: job.kind, ms: Date.now() - started, result });
    } catch (err) {
      const outcome = await fail(job, workerId, err);
      log(outcome === 'failed' ? 'error' : 'warn', outcome === 'failed' ? 'Zadanie nieudane' : 'Zadanie do ponowienia', {
        id: job.id,
        kind: job.kind,
        attempt: job.attempts,
        error: (err as Error).message,
      });
    }
  }
  await pool.end();
}

main().catch((err) => {
  log('error', 'Worker zatrzymany przez błąd', { error: (err as Error).message });
  process.exit(1);
});
