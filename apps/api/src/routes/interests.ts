import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { addInterestSchema, patchInterestSchema } from '@readyou/shared';
import { parse, requireUser } from '../http.ts';
import { addInterest, listInterests, removeInterest, resetLearned, setInterestState } from '../services/interests.ts';

const idParams = z.object({ id: z.uuid() });
const deleteQuery = z.object({ block: z.enum(['true', 'false']).default('false') });

export const interestRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  app.get('/me/interests', async (request) => listInterests(request.user.id));

  app.post('/me/interests', async (request, reply) => {
    const body = parse(addInterestSchema, request.body);
    return reply.status(201).send(await addInterest(request.user.id, body));
  });

  app.patch('/me/interests/:id', async (request) => {
    const { id } = parse(idParams, request.params);
    const { state } = parse(patchInterestSchema, request.body);
    return setInterestState(request.user.id, id, state);
  });

  app.delete('/me/interests/:id', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const { block } = parse(deleteQuery, request.query);
    await removeInterest(request.user.id, id, block === 'true');
    return reply.status(204).send();
  });

  app.post('/me/interests/reset-learned', async (request) => ({ removed: await resetLearned(request.user.id) }));
};
