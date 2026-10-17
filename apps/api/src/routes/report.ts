import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ReportSummary, ReportView } from '@readyou/shared';
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

const summaryColumns = ['r.id', 'r.period_key', 'r.subject', 'r.status', 'r.generated_at', 'r.scheduled_for', 'd.status as delivery'] as const;

function toSummary(r: { id: string; period_key: string; subject: string; status: 'ready' | 'empty'; generated_at: Date; scheduled_for: Date; delivery: ReportSummary['delivery'] }): ReportSummary {
  return { id: r.id, periodKey: r.period_key, subject: r.subject, status: r.status, generatedAt: r.generated_at.toISOString(), scheduledFor: r.scheduled_for.toISOString(), delivery: r.delivery };
}

export const reportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  /** Archiwum raportów — tylko własne (kontrola właściciela w zapytaniu). */
  app.get('/me/reports', async (request): Promise<ReportSummary[]> => {
    const rows = await db
      .selectFrom('weekly_report as r')
      .leftJoin('email_delivery as d', 'd.report_id', 'r.id')
      .select(summaryColumns)
      .where('r.user_id', '=', request.user.id)
      .orderBy('r.generated_at', 'desc')
      .limit(52)
      .execute();
    return rows.map(toSummary);
  });

  app.get('/me/reports/:id', async (request): Promise<ReportView> => {
    const { id } = parse(z.object({ id: z.uuid() }), request.params);
    const r = await db
      .selectFrom('weekly_report as r')
      .leftJoin('email_delivery as d', 'd.report_id', 'r.id')
      .select([...summaryColumns, 'r.content'])
      .where('r.id', '=', id)
      .where('r.user_id', '=', request.user.id)
      .executeTakeFirst();
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'Nie znaleziono raportu');
    return { ...toSummary(r), content: r.content };
  });

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
