import {
  TAXONOMY,
  answerDfs,
  backDfs,
  createDfsState,
  currentQuestion,
  dfsSelections,
  enoughDfs,
  pendingCount,
  skipDfs,
  startDfs,
  type DfsState,
  type OnboardingStep,
} from '@readyou/shared';
import { db } from '../db.ts';
import { ensureUserRows } from '../auth.ts';
import { HttpError } from '../http.ts';
import { bumpProfileVersion } from './profile.ts';
import { materializeSelections } from './interests.ts';

async function load(userId: string) {
  let row = await db.selectFrom('onboarding_session').selectAll().where('user_id', '=', userId).executeTakeFirst();
  if (!row) {
    await ensureUserRows(userId);
    row = await db.selectFrom('onboarding_session').selectAll().where('user_id', '=', userId).executeTakeFirstOrThrow();
  }
  return { step: row.step as OnboardingStep, dfs: row.dfs_state ?? createDfsState() };
}

async function save(userId: string, step: OnboardingStep, dfs: DfsState) {
  await db
    .updateTable('onboarding_session')
    .set({ step, dfs_state: JSON.stringify(dfs), updated_at: new Date() })
    .where('user_id', '=', userId)
    .execute();
}

export async function getOnboardingStep(userId: string): Promise<OnboardingStep> {
  return (await load(userId)).step;
}

export function view(step: OnboardingStep, dfs: DfsState) {
  return {
    step,
    roots: TAXONOMY.map(({ id, label, description, illustration }) => ({ id, label, description, illustration })),
    selectedRoots: dfs.roots,
    question: currentQuestion(dfs),
    pending: pendingCount(dfs),
    dfsDone: dfs.done,
    canGoBack: dfs.history.length > 0,
    selections: dfsSelections(dfs).map(({ key, label, path, source, depth }) => ({ key, label, path, source, depth })),
  };
}

export async function getOnboarding(userId: string) {
  const { step, dfs } = await load(userId);
  return view(step, dfs);
}

/** Nawigacja między krokami liniowymi. Przejście do „tags” zapisuje wybory DFS jako jawne zainteresowania. */
export async function setStep(userId: string, step: OnboardingStep) {
  const { dfs } = await load(userId);
  if (step === 'deepen' && dfs.roots.length === 0) {
    throw new HttpError(409, 'NO_ROOTS', 'Najpierw wybierz zainteresowania');
  }
  if (step === 'tags') {
    if (dfs.roots.length === 0) throw new HttpError(409, 'NO_ROOTS', 'Najpierw wybierz zainteresowania');
    await materializeSelections(userId, dfsSelections(dfs));
  }
  if (step === 'done') {
    await db
      .updateTable('user_profile')
      .set({ onboarding_completed_at: new Date(), updated_at: new Date() })
      .where('user_id', '=', userId)
      .execute();
    await bumpProfileVersion(userId);
  }
  await save(userId, step, dfs);
  return view(step, dfs);
}

export type DfsAction =
  | { action: 'start'; rootIds: string[]; custom: { label: string; sense?: string }[] }
  | { action: 'answer'; optionIds: string[]; custom: { label: string; sense?: string }[] }
  | { action: 'skip' }
  | { action: 'enough' }
  | { action: 'back' };

export async function applyDfs(userId: string, input: DfsAction) {
  const { dfs } = await load(userId);
  let next: DfsState;
  switch (input.action) {
    case 'start':
      // Zmiana kategorii głównych zaczyna pogłębianie od nowa, ale cofnięcie „Wstecz” nadal działa.
      next = startDfs(dfs, input.rootIds, input.custom);
      break;
    case 'answer':
      next = answerDfs(dfs, input.optionIds, input.custom);
      break;
    case 'skip':
      next = skipDfs(dfs);
      break;
    case 'enough':
      next = enoughDfs(dfs);
      break;
    case 'back':
      next = backDfs(dfs);
      break;
  }
  const step: OnboardingStep = next.roots.length === 0 ? 'interests' : 'deepen';
  await save(userId, step, next);
  return view(step, next);
}
