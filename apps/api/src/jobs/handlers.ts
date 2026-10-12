import { z } from 'zod';
import { getEmbeddingProvider } from '../providers.ts';
import { EMBED_INTERESTS_JOB, syncInterestEmbeddings } from '../services/embeddings.ts';
import type { Job } from './queue.ts';

export type JobHandler = (job: Job) => Promise<Record<string, unknown> | void>;

const userPayload = z.object({ userId: z.string().min(1) });

export const handlers: Record<string, JobHandler> = {
  [EMBED_INTERESTS_JOB]: async (job) => {
    const { userId } = userPayload.parse(job.payload);
    const provider = getEmbeddingProvider();
    // Jawnie wyłączone embeddingi: kończymy bez wyniku, bez udawania wektorów.
    if (!provider) return { skipped: 'EMBEDDING_PROVIDER=disabled' };
    return syncInterestEmbeddings(userId, provider);
  },
};
