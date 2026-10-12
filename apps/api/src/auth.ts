import { betterAuth } from 'better-auth';
import { DEFAULT_TIMEZONE } from '@readyou/shared';
import { db, pool } from './db.ts';
import { env, googleEnabled } from './env.ts';
import { sendInBackground } from './email/provider.ts';
import { resetPasswordEmail, verificationEmail } from './email/templates.ts';

const logEmailError = (err: unknown) => console.error('[auth] błąd wysyłki e-maila', err instanceof Error ? err.message : err);

/**
 * Tworzy puste rekordy profilu i (wyłączonej) subskrypcji raportu dla nowego konta.
 * Idempotentne — bezpieczne przy ponowieniach.
 */
export async function ensureUserRows(userId: string) {
  await db
    .insertInto('user_profile')
    .values({ user_id: userId, timezone: DEFAULT_TIMEZONE })
    .onConflict((oc) => oc.column('user_id').doNothing())
    .execute();
  await db
    .insertInto('report_subscription')
    .values({ user_id: userId })
    .onConflict((oc) => oc.column('user_id').doNothing())
    .execute();
  await db
    .insertInto('onboarding_session')
    .values({ user_id: userId })
    .onConflict((oc) => oc.column('user_id').doNothing())
    .execute();
}

export const auth = betterAuth({
  appName: 'ReadYou',
  baseURL: env.APP_URL,
  basePath: '/api/auth',
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],
  database: pool,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // Adres odbiorcy pochodzi z bazy (user.email), nie z treści żądania.
      sendInBackground({ to: user.email, ...resetPasswordEmail(url) }, logEmailError);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      sendInBackground({ to: user.email, ...verificationEmail(user.name, url) }, logEmailError);
    },
  },
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID!,
          clientSecret: env.GOOGLE_CLIENT_SECRET!,
          prompt: 'select_account',
        },
      }
    : {},
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 5 },
      '/request-password-reset': { window: 300, max: 3 },
      '/send-verification-email': { window: 300, max: 3 },
    },
  },
  advanced: {
    useSecureCookies: env.NODE_ENV === 'production',
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await ensureUserRows(user.id);
        },
      },
    },
  },
});
