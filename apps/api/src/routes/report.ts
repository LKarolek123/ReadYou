import type { FastifyPluginAsync } from 'fastify';
import { nextReportAt, reportSubscriptionPatchSchema, type ReportSubscription } from '@readyou/shared';
import { db } from '../db.ts';
import { HttpError, parse, requireUser } from '../http.ts';
import { getProfile } from '../services/profile.ts';

async function getSubscription(userId: string, emailVerified: boolean): Promise<ReportSubscription> {
  const profile = await getProfile(userId); // zapewnia też istnienie wiersza subskrypcji
  const row = await db
    .selectFrom('report_subscription')
    .select(['enabled', 'weekday', 'local_time'])
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow();
  const active = row.enabled && emailVerified;
  return {
    enabled: row.enabled,
    weekday: row.weekday,
    localTime: row.local_time,
    timezone: profile.timezone,
    emailVerified,
    nextSendAt: active ? nextReportAt(new Date(), profile.timezone, row.weekday, row.local_time).toISOString() : null,
  };
}

export const reportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  app.get('/me/report-subscription', async (request) =>
    getSubscription(request.user.id, request.user.emailVerified),
  );

  app.patch('/me/report-subscription', async (request) => {
    const patch = parse(reportSubscriptionPatchSchema, request.body);
    if (patch.enabled && !request.user.emailVerified) {
      throw new HttpError(409, 'EMAIL_NOT_VERIFIED', 'Potwierdź adres e-mail, aby zapisać się na raport');
    }
    await getProfile(request.user.id);
    await db
      .updateTable('report_subscription')
      .set({
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.weekday !== undefined ? { weekday: patch.weekday } : {}),
        ...(patch.localTime !== undefined ? { local_time: patch.localTime } : {}),
        updated_at: new Date(),
      })
      .where('user_id', '=', request.user.id)
      .execute();
    return getSubscription(request.user.id, request.user.emailVerified);
  });
};
