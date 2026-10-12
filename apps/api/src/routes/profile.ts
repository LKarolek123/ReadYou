import type { FastifyPluginAsync } from 'fastify';
import { profilePatchSchema } from '@readyou/shared';
import { parse, requireUser } from '../http.ts';
import { getProfile, patchProfile } from '../services/profile.ts';
import { getOnboardingStep } from '../services/onboarding.ts';

export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  app.get('/me', async (request) => {
    const { id, email, name, emailVerified, image } = request.user;
    const [profile, onboardingStep] = await Promise.all([getProfile(id), getOnboardingStep(id)]);
    return { user: { id, email, name, emailVerified, image: image ?? null }, profile, onboardingStep };
  });

  app.get('/me/profile', async (request) => getProfile(request.user.id));

  app.patch('/me/profile', async (request) => {
    const patch = parse(profilePatchSchema, request.body);
    return patchProfile(request.user.id, patch);
  });
};
