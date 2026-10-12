import { findSenses, getNode, matchTaxonomy, normalizeTag, type Interest, type Selection } from '@readyou/shared';
import { db } from '../db.ts';
import { HttpError } from '../http.ts';
import { bumpProfileVersion } from './profile.ts';

type Row = {
  id: string;
  label: string;
  normalized: string;
  state: Interest['state'];
  origin: Interest['origin'];
  path: string[];
  node_key: string | null;
  weight: number;
  created_at: Date;
};

const toInterest = (r: Row): Interest => ({
  id: r.id,
  label: r.label,
  normalized: r.normalized,
  state: r.state,
  origin: r.origin,
  path: r.path,
  nodeId: r.node_key,
  weight: r.weight,
  createdAt: r.created_at.toISOString(),
});

const columns = ['id', 'label', 'normalized', 'state', 'origin', 'path', 'node_key', 'weight', 'created_at'] as const;

export async function listInterests(userId: string): Promise<Interest[]> {
  const rows = await db
    .selectFrom('user_interest')
    .select(columns)
    .where('user_id', '=', userId)
    .orderBy('created_at')
    .orderBy('label')
    .execute();
  return rows.map((r) => toInterest(r as unknown as Row));
}

/**
 * Zapisuje wybory DFS jako jawne zainteresowania (origin=onboarding).
 * Idempotentne: ponowne przejście onboardingu zastępuje wcześniejsze wybory z onboardingu,
 * ale nie rusza tagów dodanych ręcznie ani wykluczeń (wykluczenie ma pierwszeństwo).
 */
export async function materializeSelections(userId: string, selections: Selection[]) {
  await db.transaction().execute(async (trx) => {
    for (const s of selections) {
      await trx
        .insertInto('interest_node')
        .values({
          key: s.key,
          label: s.label,
          normalized: s.normalized,
          parent_key: s.pathKeys.at(-2) ?? null,
          origin: s.source,
        })
        .onConflict((oc) => oc.column('key').doNothing())
        .execute();
    }

    const keep = selections.map((s) => s.normalized);
    let del = trx
      .deleteFrom('user_interest')
      .where('user_id', '=', userId)
      .where('origin', '=', 'onboarding')
      .where('state', '=', 'explicit');
    if (keep.length) del = del.where('normalized', 'not in', keep);
    await del.execute();

    for (const s of selections) {
      await trx
        .insertInto('user_interest')
        .values({
          user_id: userId,
          node_key: s.key,
          label: s.label,
          normalized: s.normalized,
          path: s.path,
          state: 'explicit',
          origin: 'onboarding',
          // Liść jest bardziej szczegółowy, ale ogólne zainteresowanie pozostaje aktywne.
          weight: 1,
        })
        .onConflict((oc) => oc.columns(['user_id', 'normalized']).doNothing())
        .execute();
    }
  });
  await bumpProfileVersion(userId);
}

export async function addInterest(
  userId: string,
  input: { label: string; state: 'explicit' | 'excluded'; sense?: string },
): Promise<Interest> {
  let label = input.label.trim();
  let nodeId: string | undefined;
  const senses = findSenses(label);
  if (senses) {
    const chosen = senses.find((s) => s.label === input.sense);
    if (!chosen) throw new HttpError(422, 'AMBIGUOUS', `„${label}” ma kilka znaczeń`, { label, senses });
    label = chosen.label;
    nodeId = chosen.nodeId;
  } else {
    nodeId = matchTaxonomy(label);
  }
  const indexed = nodeId ? getNode(nodeId) : undefined;
  const path = indexed ? indexed.path.map((id) => getNode(id)!.node.label) : [label];
  if (indexed) label = indexed.node.label;
  const normalized = normalizeTag(label);
  if (!normalized) throw new HttpError(400, 'VALIDATION_ERROR', 'Pusta etykieta');

  // Jawna decyzja użytkownika nadpisuje wcześniejszy stan tego tagu (np. wyuczony → wykluczony).
  const row = await db
    .insertInto('user_interest')
    .values({
      user_id: userId,
      node_key: nodeId ?? null,
      label,
      normalized,
      path,
      state: input.state,
      origin: 'manual',
    })
    .onConflict((oc) =>
      oc.columns(['user_id', 'normalized']).doUpdateSet({ state: input.state, origin: 'manual', updated_at: new Date() }),
    )
    .returning(columns)
    .executeTakeFirstOrThrow();
  await bumpProfileVersion(userId);
  return toInterest(row as unknown as Row);
}

export async function setInterestState(userId: string, id: string, state: 'explicit' | 'excluded'): Promise<Interest> {
  const row = await db
    .updateTable('user_interest')
    .set({ state, updated_at: new Date() })
    .where('id', '=', id)
    .where('user_id', '=', userId) // kontrola własności
    .returning(columns)
    .executeTakeFirst();
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Nie znaleziono zainteresowania');
  await bumpProfileVersion(userId);
  return toInterest(row as unknown as Row);
}

/**
 * Usuwa tag. Dla tagu wyuczonego z `block=true` zamienia go w wykluczenie,
 * żeby uczenie nie odtworzyło go natychmiast.
 */
export async function removeInterest(userId: string, id: string, block: boolean) {
  const existing = await db
    .selectFrom('user_interest')
    .select(['state'])
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Nie znaleziono zainteresowania');
  if (block) {
    await db
      .updateTable('user_interest')
      .set({ state: 'excluded', origin: 'manual', updated_at: new Date() })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .execute();
  } else {
    await db.deleteFrom('user_interest').where('id', '=', id).where('user_id', '=', userId).execute();
  }
  await bumpProfileVersion(userId);
}

/** Reset preferencji wyuczonych — jawne zainteresowania i wykluczenia zostają. */
export async function resetLearned(userId: string) {
  const res = await db
    .deleteFrom('user_interest')
    .where('user_id', '=', userId)
    .where('state', '=', 'learned')
    .executeTakeFirst();
  await bumpProfileVersion(userId);
  return Number(res.numDeletedRows);
}
