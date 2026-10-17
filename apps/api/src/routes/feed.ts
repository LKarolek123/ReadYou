import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { contentStatePatchSchema, EVENT_RANGES, interactionSchema, type FeedView } from '@readyou/shared';
import { eventFeed } from '../services/events.ts';
import { getTrending } from '../services/trending.ts';
import { db } from '../db.ts';
import { parse, requireUser } from '../http.ts';
import { enqueue } from '../jobs/queue.ts';
import { BUILD_POOL_JOB, localDay, POOL_LIMIT } from '../engine/pool.ts';
import { getCard, getSummaryView, listMyArticles, logInteraction, setContentState, todaysCards } from '../services/content.ts';

const idParams = z.object({ id: z.uuid() });
const eventsQuery = z.object({ range: z.enum(EVENT_RANGES).default('today'), cursor: z.string().max(200).optional() });
const listQuery = z.object({ state: z.enum(['liked-unread', 'read']).default('liked-unread'), cursor: z.string().max(200).optional() });

/** Zleca budowę/uzupełnienie puli w workerze (deduplikacja per użytkownik i dzień). */
function schedulePool(userId: string, day: string) {
  return enqueue(BUILD_POOL_JOB, { userId }, { dedupeKey: `${BUILD_POOL_JOB}:${userId}:${day}` });
}

export const feedRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  app.get('/feed/articles', async (request): Promise<FeedView> => {
    const userId = request.user.id;
    const profile = await db.selectFrom('user_profile').select(['timezone']).where('user_id', '=', userId).executeTakeFirstOrThrow();
    const day = localDay(profile.timezone);
    const { assigned, items } = await todaysCards(userId, day);
    const pending = await db
      .selectFrom('job')
      .select('id')
      .where('dedupe_key', '=', `${BUILD_POOL_JOB}:${userId}:${day}`)
      .where('status', 'in', ['queued', 'running'])
      .executeTakeFirst();
    if (!assigned && !pending) {
      // Pierwsze otwarcie dnia: pula powstaje w tle; front odpytuje, dopóki status = preparing.
      await schedulePool(userId, day);
      return { day, status: 'preparing', items: [], assigned: 0, limit: POOL_LIMIT, notice: null };
    }
    if (!assigned) return { day, status: 'preparing', items: [], assigned: 0, limit: POOL_LIMIT, notice: null };
    return {
      day,
      status: items.length ? 'ready' : 'empty',
      items,
      assigned,
      limit: POOL_LIMIT,
      notice: assigned < POOL_LIMIT ? `Dziś mamy ${assigned} z ${POOL_LIMIT} — nie dopełniamy puli słabszymi treściami.` : null,
    };
  });

  // Uzupełnienie wolnych slotów (bez nowej paczki 20). Ograniczone limitem żądań i odstępem w workerze.
  app.post('/feed/refresh', { config: { rateLimit: { max: 6, timeWindow: '1 hour' } } }, async (request, reply) => {
    const profile = await db.selectFrom('user_profile').select(['timezone']).where('user_id', '=', request.user.id).executeTakeFirstOrThrow();
    await schedulePool(request.user.id, localDay(profile.timezone));
    return reply.status(202).send({ status: 'queued' });
  });

  app.get('/content/:id', async (request) => getCard(request.user.id, parse(idParams, request.params).id));
  app.get('/content/:id/summary', async (request) => getSummaryView(request.user.id, parse(idParams, request.params).id));

  app.put('/me/content/:id/state', async (request) => {
    const { id } = parse(idParams, request.params);
    return setContentState(request.user.id, id, parse(contentStatePatchSchema, request.body));
  });

  app.post('/interactions', async (request, reply) => {
    await logInteraction(request.user.id, parse(interactionSchema, request.body));
    return reply.status(204).send();
  });

  app.get('/trending', async (request) => getTrending(request.user.id, parse(z.object({ kind: z.enum(['news', 'events']).default('news') }), request.query).kind));

  app.get('/feed/events', async (request) => {
    const q = parse(eventsQuery, request.query);
    return eventFeed(request.user.id, q.range, q.cursor);
  });

  // Zapisane wydarzenia, kluby i miejsca (polubione) — osobno od „Twoich artykułów”.
  app.get('/me/saved', async (request) => eventFeed(request.user.id, 'saved', parse(z.object({ cursor: z.string().max(200).optional() }), request.query).cursor));

  app.get('/me/articles', async (request) => {
    const q = parse(listQuery, request.query);
    return listMyArticles(request.user.id, q.state, q.cursor);
  });
};
