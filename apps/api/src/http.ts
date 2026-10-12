import type { FastifyReply, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { ZodType } from 'zod';
import { auth } from './auth.ts';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image?: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser;
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** preHandler: wymaga sesji. Tożsamość wyłącznie z ciasteczka sesji — nigdy z userId od klienta. */
export async function requireUser(request: FastifyRequest, _reply: FastifyReply) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session) throw new HttpError(401, 'UNAUTHORIZED', 'Zaloguj się, aby kontynuować');
  request.user = session.user as SessionUser;
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Nieprawidłowe dane',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
