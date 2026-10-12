import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { DfsError, ONBOARDING_STEPS } from '@readyou/shared';
import { HttpError, parse, requireUser } from '../http.ts';
import { applyDfs, getOnboarding, setStep, type DfsAction } from '../services/onboarding.ts';

const custom = z
  .array(z.object({ label: z.string().trim().min(1).max(60), sense: z.string().max(80).optional() }))
  .max(10)
  .default([]);

const dfsSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), rootIds: z.array(z.string().max(80)).max(20).default([]), custom }),
  z.object({ action: z.literal('answer'), optionIds: z.array(z.string().max(120)).max(20).default([]), custom }),
  z.object({ action: z.literal('skip') }),
  z.object({ action: z.literal('enough') }),
  z.object({ action: z.literal('back') }),
]);

const stepSchema = z.object({ step: z.enum(ONBOARDING_STEPS) });

export const onboardingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  app.get('/onboarding', async (request) => getOnboarding(request.user.id));

  app.post('/onboarding/step', async (request) => {
    const { step } = parse(stepSchema, request.body);
    return setStep(request.user.id, step);
  });

  /** Kolejny krok DFS (odpowiednik POST /onboarding/next ze specyfikacji). */
  app.post('/onboarding/next', async (request) => {
    const input = parse(dfsSchema, request.body) as DfsAction;
    try {
      return await applyDfs(request.user.id, input);
    } catch (err) {
      if (err instanceof DfsError) {
        const status = err.code === 'AMBIGUOUS' ? 422 : 409;
        throw new HttpError(status, err.code, err.message, err.senses);
      }
      throw err;
    }
  });
};
