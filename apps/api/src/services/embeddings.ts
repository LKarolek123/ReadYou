/**
 * Wektory zainteresowań: osobny wektor dla każdego jawnego lub wyuczonego zainteresowania.
 *
 * Tekst wektora to pełna ścieżka gałęzi (np. „Informatyka > Sztuczna inteligencja > Agenci AI > RAG”).
 * Sama etykieta bywa za krótka dla modelu: „RAG” czy „Szachy” bez kontekstu dają słabo
 * rozróżnialne wektory, a ścieżka podaje dziedzinę.
 *
 * Do tekstu nie trafiają e-mail ani identyfikatory konta — tylko etykiety zainteresowań.
 */
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { EmbeddingProvider } from '@readyou/providers';
import { db, toPgVector } from '../db.ts';
import { enqueue } from '../jobs/queue.ts';

export const EMBED_INTERESTS_JOB = 'embed_user_interests';

export function interestText(label: string, path: readonly string[]): string {
  const parts = path.length ? [...path] : [label];
  if (parts.at(-1) !== label) parts.push(label);
  return parts.join(' > ');
}

const sourceHash = (model: string, text: string) => createHash('sha256').update(`${model}\n${text}`).digest('hex');

/** Zleca przeliczenie wektorów użytkownika; równoległe zlecenia zlewają się w jedno zadanie. */
export function scheduleInterestEmbeddings(userId: string) {
  return enqueue(EMBED_INTERESTS_JOB, { userId }, { dedupeKey: `${EMBED_INTERESTS_JOB}:${userId}` });
}

/**
 * Doprowadza wektory użytkownika do stanu zgodnego z jego zainteresowaniami:
 * liczy brakujące lub nieaktualne (inny tekst lub model), usuwa niepotrzebne (wykluczone).
 * Idempotentne — ponowienie niczego nie dubluje.
 */
export async function syncInterestEmbeddings(userId: string, provider: EmbeddingProvider) {
  const profile = await db
    .selectFrom('user_profile')
    .select('profile_version')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!profile) return { computed: 0, removed: 0, kept: 0 }; // konto usunięte w międzyczasie

  const interests = await db
    .selectFrom('user_interest')
    .select(['id', 'label', 'path', 'state'])
    .where('user_id', '=', userId)
    .execute();
  const existing = await db
    .selectFrom('user_interest_embedding')
    .select(['interest_id', 'model', 'source_hash'])
    .where('user_id', '=', userId)
    .execute();
  const existingById = new Map(existing.map((e) => [e.interest_id, e]));

  const active = interests.filter((i) => i.state !== 'excluded');
  const activeIds = new Set(active.map((i) => i.id));
  const stale = existing.filter((e) => !activeIds.has(e.interest_id) || e.model !== provider.model).map((e) => e.interest_id);

  const todo = active
    .map((i) => {
      const text = interestText(i.label, i.path);
      return { id: i.id, text, hash: sourceHash(provider.model, text) };
    })
    .filter((t) => existingById.get(t.id)?.source_hash !== t.hash);

  // Po kolei: model działa na CPU, równoległe wywołania niczego nie przyspieszą.
  const vectors: number[][] = [];
  for (const t of todo) vectors.push(await provider.embedQuery(t.text));
  for (const v of vectors) {
    if (v.length !== provider.dim) throw new Error(`Model zwrócił wymiar ${v.length}, oczekiwano ${provider.dim}`);
  }

  await db.transaction().execute(async (trx) => {
    if (stale.length) {
      await trx.deleteFrom('user_interest_embedding').where('user_id', '=', userId).where('interest_id', 'in', stale).execute();
    }
    for (const [i, t] of todo.entries()) {
      // Zainteresowanie mogło zostać usunięte lub wykluczone w trakcie liczenia — wtedy nic nie wstawiamy.
      await sql`
        insert into user_interest_embedding (interest_id, user_id, model, dim, source_hash, profile_version, embedding)
        select ui.id, ui.user_id, ${provider.model}, ${provider.dim}, ${t.hash}, ${profile.profile_version},
               ${toPgVector(vectors[i]!)}::vector
        from user_interest ui
        where ui.id = ${t.id} and ui.user_id = ${userId} and ui.state <> 'excluded'
        on conflict (interest_id) do update set
          model = excluded.model, dim = excluded.dim, source_hash = excluded.source_hash,
          profile_version = excluded.profile_version, embedding = excluded.embedding, created_at = now()`.execute(trx);
    }
  });

  return { computed: todo.length, removed: stale.length, kept: active.length - todo.length };
}

/** Stan wektorów użytkownika (do profilu/diagnostyki). */
export async function interestEmbeddingStatus(userId: string, model: string | null) {
  const [interests, embedded] = await Promise.all([
    db
      .selectFrom('user_interest')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('user_id', '=', userId)
      .where('state', '!=', 'excluded')
      .executeTakeFirstOrThrow(),
    model
      ? db
          .selectFrom('user_interest_embedding')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('user_id', '=', userId)
          .where('model', '=', model)
          .executeTakeFirstOrThrow()
      : Promise.resolve({ n: 0 }),
  ]);
  return { model, interests: Number(interests.n), embedded: Number(embedded.n) };
}
