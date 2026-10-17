/**
 * Streszczenia: tworzone raz na treść (wspólne dla wszystkich odbiorców), przed publikacją kart.
 * Kliknięcie „książki” czyta zapisany wynik — nigdy nie woła modelu.
 *
 * Cache: (treść, hash dowodów, wersja promptu, model, język). Nowy tekst źródła albo nowa wersja
 * promptu = nowe streszczenie; stare zostaje w historii.
 */
import { createHash } from 'node:crypto';
import { MAX_SOURCE_CHARS, ProviderNotConfiguredError, type SummaryProvider } from '@readyou/providers';
import { TAXONOMY_INDEX } from '@readyou/shared';
import { db } from '../db.ts';
import { enqueue } from '../jobs/queue.ts';
import { estimateCostUsd, reserveLlm, settleLlm } from './llm-budget.ts';

export const SUMMARIZE_JOB = 'summarize_content';

/** Tematy do tagowania: wszystkie węzły taksonomii z pełną ścieżką (stała lista = stabilny prompt). */
export const TAG_CHOICES = [...TAXONOMY_INDEX.values()].map((n) => ({
  id: n.node.id,
  label: n.path.map((id) => TAXONOMY_INDEX.get(id)!.node.label).join(' > '),
}));

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function scheduleSummary(contentId: string) {
  return enqueue(SUMMARIZE_JOB, { contentId }, { dedupeKey: `${SUMMARIZE_JOB}:${contentId}` });
}

export async function latestSummary(contentId: string) {
  return db
    .selectFrom('summary')
    .selectAll()
    .where('content_id', '=', contentId)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
}

export type SummarizeOutcome =
  | { status: 'cached' | 'created'; sufficient: boolean }
  | { status: 'skipped'; reason: string }
  | { status: 'budget_exhausted' };

export async function summarizeContent(contentId: string, provider: SummaryProvider): Promise<SummarizeOutcome> {
  const item = await db
    .selectFrom('content_item as c')
    .leftJoin('content_text as t', 't.content_id', 'c.id')
    .select(['c.id', 'c.title', 'c.url', 'c.source_name', 'c.published_at', 'c.description', 'c.status', 't.text'])
    .where('c.id', '=', contentId)
    .executeTakeFirst();
  if (!item) return { status: 'skipped', reason: 'brak treści' };
  if (!['extracted', 'partial'].includes(item.status)) return { status: 'skipped', reason: `status ${item.status}` };

  const evidence = `${item.title}\n${item.description ?? ''}\n${item.text ?? ''}`;
  const sourceHash = sha(evidence);
  const cached = await db
    .selectFrom('summary')
    .select(['sufficient'])
    .where('content_id', '=', contentId)
    .where('source_hash', '=', sourceHash)
    .where('prompt_version', '=', provider.promptVersion)
    .where('model', '=', provider.model)
    .executeTakeFirst();
  if (cached) return { status: 'cached', sufficient: cached.sufficient };

  // Górne oszacowanie kosztu: ~3,5 znaku na token wejścia + prompt i lista tematów, do 1500 tokenów wyjścia.
  const inputEstimate = Math.ceil((Math.min(item.text?.length ?? 0, MAX_SOURCE_CHARS) + 9000) / 3.5);
  const reserved = estimateCostUsd(inputEstimate, 1500);
  if (!(await reserveLlm(provider.model, reserved))) return { status: 'budget_exhausted' };

  let result;
  try {
    result = await provider.summarize(
      {
        title: item.title,
        url: item.url,
        sourceName: item.source_name,
        publishedAt: item.published_at,
        description: item.description,
        text: item.text,
        partial: item.status === 'partial',
      },
      TAG_CHOICES,
    );
  } catch (e) {
    await settleLlm(provider.model, reserved, null);
    if (e instanceof ProviderNotConfiguredError) return { status: 'skipped', reason: e.message };
    throw e;
  }
  await settleLlm(provider.model, reserved, result.usage);

  await db
    .insertInto('summary')
    .values({
      content_id: contentId,
      source_hash: sourceHash,
      prompt_version: result.promptVersion,
      model: result.model,
      sufficient: result.sufficient,
      card_description: result.card_description || null,
      summary: result.summary || null,
      key_facts: JSON.stringify(result.key_facts),
      caveats: JSON.stringify(result.caveats),
      tags: result.tags,
      basis: result.basis,
      input_tokens: result.usage.inputTokens + result.usage.cacheReadTokens,
      output_tokens: result.usage.outputTokens,
      created_at: new Date(),
    })
    .onConflict((oc) => oc.columns(['content_id', 'source_hash', 'prompt_version', 'model', 'language']).doNothing())
    .execute();
  return { status: 'created', sufficient: result.sufficient };
}
