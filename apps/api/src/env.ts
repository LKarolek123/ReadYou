import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url().default('http://localhost:5173'),
  API_PORT: z.coerce.number().int().default(3001),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET musi mieć co najmniej 32 znaki'),
  GOOGLE_CLIENT_ID: z.string().optional().transform((v) => v || undefined),
  GOOGLE_CLIENT_SECRET: z.string().optional().transform((v) => v || undefined),
  EMAIL_PROVIDER: z.enum(['smtp-dev', 'disabled']).default('smtp-dev'),
  SMTP_HOST: z.string().default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  EMAIL_FROM: z.string().default('ReadYou <no-reply@readyou.local>'),
  // Embeddingi liczone lokalnie (multilingual-e5-small); `disabled` wyłącza je jawnie.
  EMBEDDING_PROVIDER: z.enum(['e5-local', 'disabled']).default('e5-local'),
  EMBEDDING_CACHE_DIR: z.string().default('.cache/models'),
  WORKER_POLL_MS: z.coerce.number().int().min(100).default(1000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Bez wartości zmiennych — tylko nazwy i komunikaty, żeby nie wyciekły sekrety.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Błędna konfiguracja środowiska (sprawdź .env, wzór w .env.example):\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;
export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
