import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db.ts';
import { requireUser } from '../http.ts';
import { getProfile } from '../services/profile.ts';
import { listInterests } from '../services/interests.ts';

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  /** Eksport danych konta (bez haseł, tokenów i sesji). */
  app.get('/me/export', async (request, reply) => {
    const userId = request.user.id;
    const [user, profile, interests, report, onboarding, accounts] = await Promise.all([
      db.selectFrom('user').select(['email', 'name', 'emailVerified', 'createdAt']).where('id', '=', userId).executeTakeFirst(),
      getProfile(userId),
      listInterests(userId),
      db.selectFrom('report_subscription').select(['enabled', 'weekday', 'local_time']).where('user_id', '=', userId).executeTakeFirst(),
      db.selectFrom('onboarding_session').select(['step', 'updated_at']).where('user_id', '=', userId).executeTakeFirst(),
      db.selectFrom('account').select(['providerId']).where('userId', '=', userId).execute(),
    ]);
    const body = {
      exportedAt: new Date().toISOString(),
      account: { ...user, loginMethods: accounts.map((a) => a.providerId) },
      profile,
      interests,
      reportSubscription: report,
      onboarding,
    };
    reply.header('content-disposition', 'attachment; filename="readyou-export.json"');
    return body;
  });

  /**
   * Usunięcie konta. Kaskada usuwa profil, zainteresowania, sesje, onboarding i subskrypcję.
   * Wspólne publiczne treści (katalog węzłów) zostają — nie zawierają danych osobowych.
   */
  app.delete('/me', async (request, reply) => {
    await db.deleteFrom('user').where('id', '=', request.user.id).execute();
    return reply.status(204).send();
  });
};
