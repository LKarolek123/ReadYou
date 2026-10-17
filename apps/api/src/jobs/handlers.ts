import { z } from 'zod';
import { ProviderRateLimitError, ProviderUnavailableError, type EmbeddingProvider } from '@readyou/providers';
import { getEmbeddingProvider, getEventExtractor, getSummaryProvider } from '../providers.ts';
import { EVENT_JOBS, ingestEventSource, ingestPlaces, searchEvents } from '../engine/events.ts';
import { runTrending, TRENDING_JOB } from '../engine/trending.ts';
import { SUMMARIZE_JOB, summarizeContent } from '../engine/summaries.ts';
import { BUILD_POOL_JOB, fillDailyPool } from '../engine/pool.ts';
import { recomputeLearned, RECOMPUTE_LEARNED_JOB } from '../engine/learning.ts';
import { EMBED_INTERESTS_JOB, syncInterestEmbeddings } from '../services/embeddings.ts';
import { extractContent, ingestFeed, JOBS, searchTopic } from '../engine/discovery.ts';
import { RetryLaterError, type Job } from './queue.ts';

export type JobHandler = (job: Job) => Promise<Record<string, unknown> | void>;

const userPayload = z.object({ userId: z.string().min(1) });

/** Zadania wymagające wektorów: bez dostawcy embeddingów kończą się jawnie, bez udawania wyników. */
function withEmbeddings(fn: (job: Job, provider: EmbeddingProvider) => Promise<Record<string, unknown> | void>): JobHandler {
  return async (job) => {
    const provider = getEmbeddingProvider();
    if (!provider) return { skipped: 'EMBEDDING_PROVIDER=disabled' };
    try {
      return await fn(job, provider);
    } catch (e) {
      if (e instanceof ProviderRateLimitError || e instanceof ProviderUnavailableError) throw new RetryLaterError(e.message, e.retryAfterMs);
      throw e;
    }
  };
}

export const handlers: Record<string, JobHandler> = {
  [EMBED_INTERESTS_JOB]: withEmbeddings((job, p) => syncInterestEmbeddings(userPayload.parse(job.payload).userId, p)),
  [JOBS.ingestFeed]: withEmbeddings((job, p) => ingestFeed(z.object({ feedUrl: z.string().url() }).parse(job.payload).feedUrl, p)),
  [JOBS.searchTopic]: withEmbeddings((job, p) => searchTopic(z.object({ topicKey: z.string().min(1) }).parse(job.payload).topicKey, p)),
  [SUMMARIZE_JOB]: async (job) => {
    try {
      const out = await summarizeContent(z.object({ contentId: z.string().uuid() }).parse(job.payload).contentId, getSummaryProvider());
      // Wyczerpany budżet: spróbuj ponownie za godzinę (zapisane streszczenia działają dalej).
      if (out.status === 'budget_exhausted') throw new RetryLaterError('Budżet LLM wyczerpany', 60 * 60_000);
      return out;
    } catch (e) {
      if (e instanceof ProviderRateLimitError || e instanceof ProviderUnavailableError) throw new RetryLaterError(e.message, e.retryAfterMs);
      throw e;
    }
  },
  [BUILD_POOL_JOB]: withEmbeddings(async (job, p) => ({ ...(await fillDailyPool(userPayload.parse(job.payload).userId, p)) })),
  [RECOMPUTE_LEARNED_JOB]: async (job) => recomputeLearned(userPayload.parse(job.payload).userId),
  [EVENT_JOBS.ingestSource]: withEmbeddings((job, p) => {
    const { url, city } = z.object({ url: z.string().url(), city: z.string().min(1) }).parse(job.payload);
    return ingestEventSource(url, city, p, getEventExtractor());
  }),
  [EVENT_JOBS.searchEvents]: withEmbeddings((job, p) => searchEvents(z.object({ city: z.string().min(1) }).parse(job.payload).city, p, getEventExtractor())),
  [EVENT_JOBS.ingestPlaces]: withEmbeddings((job, p) => ingestPlaces(z.object({ city: z.string().min(1) }).parse(job.payload).city, p)),
  [TRENDING_JOB]: withEmbeddings(async (_job, p) => ({ ...(await runTrending(p)) })),
  [JOBS.extractContent]: withEmbeddings((job, p) => extractContent(z.object({ contentId: z.string().uuid() }).parse(job.payload).contentId, p)),
};
