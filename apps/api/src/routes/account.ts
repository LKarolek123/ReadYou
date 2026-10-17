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
    const [user, profile, interests, report, onboarding, accounts, articles, interactions, pools] = await Promise.all([
      db.selectFrom('user').select(['email', 'name', 'emailVerified', 'createdAt']).where('id', '=', userId).executeTakeFirst(),
      getProfile(userId),
      listInterests(userId),
      db.selectFrom('report_subscription').select(['enabled', 'weekday', 'local_time']).where('user_id', '=', userId).executeTakeFirst(),
      db.selectFrom('onboarding_session').select(['step', 'updated_at']).where('user_id', '=', userId).executeTakeFirst(),
      db.selectFrom('account').select(['providerId']).where('userId', '=', userId).execute(),
      db
        .selectFrom('user_content_state as s')
        .innerJoin('content_item as c', 'c.id', 's.content_id')
        .select(['c.title', 'c.url', 's.liked_at', 's.read_at', 's.skipped_at'])
        .where('s.user_id', '=', userId)
        .execute(),
      db.selectFrom('interaction').select(['content_id', 'type', 'created_at']).where('user_id', '=', userId).orderBy('created_at').execute(),
      db.selectFrom('daily_assignment').select(['local_day', 'slot', 'content_id', 'kind', 'reason']).where('user_id', '=', userId).orderBy('local_day').orderBy('slot').execute(),
    ]);
    const reports = await db
      .selectFrom('weekly_report as r')
      .leftJoin('email_delivery as d', 'd.report_id', 'r.id')
      .select(['r.period_key', 'r.subject', 'r.status', 'r.content', 'r.generated_at', 'd.status as delivery', 'd.sent_at'])
      .where('r.user_id', '=', userId)
      .orderBy('r.generated_at')
      .execute();
    const body = {
      exportedAt: new Date().toISOString(),
      account: { ...user, loginMethods: accounts.map((a) => a.providerId) },
      profile,
      interests,
      reportSubscription: report,
      onboarding,
      articles,
      interactions,
      dailyPools: pools,
      weeklyReports: reports,
    };
    reply.header('content-disposition', 'attachment; filename="readyou-export.json"');
    return body;
  });

  /**
   * Usunięcie konta. Kaskada usuwa profil, zainteresowania i ich wektory, sesje, onboarding, subskrypcję,
   * polubienia, historię przeczytania, interakcje, dzienne pule, raporty tygodniowe i ich wysyłki.
   * Wspólne publiczne treści (katalog węzłów, artykuły, streszczenia) zostają — nie zawierają danych osobowych.
   */
  app.delete('/me', async (request, reply) => {
    await db.deleteFrom('user').where('id', '=', request.user.id).execute();
    return reply.status(204).send();
  });
};
