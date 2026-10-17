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

  // Odkrywanie treści.
  BRAVE_SEARCH_SECRET_KEY: z.string().optional().transform((v) => v || undefined),
  // Twarde limity zapytań Brave (kredyt 5 $/mies. ≈ 1000 zapytań).
  BRAVE_DAILY_QUERY_LIMIT: z.coerce.number().int().min(0).default(30),
  BRAVE_MONTHLY_QUERY_LIMIT: z.coerce.number().int().min(0).default(900),
  // Kontakt w User-Agencie bota (adres strony lub e-mail operatora) — wymagany przez dobre praktyki crawlerów.
  CRAWLER_CONTACT: z.string().optional().transform((v) => v || undefined),
  CONTENT_LANGUAGES: z.string().default('pl,en').transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  CONTENT_MAX_AGE_DAYS: z.coerce.number().int().min(1).default(14),
  CONTENT_TEXT_TTL_DAYS: z.coerce.number().int().min(1).default(14),
  // Próg marginesu trafności (patrz docs/implementation-plan.md, kalibracja).
  RELEVANCE_THRESHOLD: z.coerce.number().default(0),
  // Ile stron najwyżej pobieramy w jednym przebiegu odkrywania tematu/kanału.
  EXTRACT_PER_RUN: z.coerce.number().int().min(1).default(10),

  // Obrazy wydawców (og:image) na kartach. Domyślnie wyłączone: adres obrazu to metadane, nie licencja;
  // zamiast tego ilustracje kategorii ReadYou. Włącz tylko przy potwierdzonych uprawnieniach źródeł.
  SHOW_SOURCE_IMAGES: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),

  // Streszczenia (Claude Haiku 5.5). Klucz tylko na serwerze.
  ANTHROPIC_API_KEY: z.string().optional().transform((v) => v?.trim() || undefined),
  SUMMARY_MODEL: z.string().default('claude-haiku-5-5'),
  // Twarde limity kosztu LLM (USD, szacunek ze stawek poniżej). Po przekroczeniu: brak nowych streszczeń.
  LLM_DAILY_BUDGET_USD: z.coerce.number().min(0).default(0.16),
  LLM_MONTHLY_BUDGET_USD: z.coerce.number().min(0).default(5),
  // Stawki do szacunku kosztu (USD za 1M tokenów). Haiku 5.5: 0,10 / 0,50 (cennik 2026-10).
  LLM_INPUT_USD_PER_MTOK: z.coerce.number().min(0).default(0.1),
  LLM_OUTPUT_USD_PER_MTOK: z.coerce.number().min(0).default(0.5),
});

// Zgodność wstecz: wcześniejsza nazwa zmiennej w .env (z literówką).
if (!process.env.ANTHROPIC_API_KEY && process.env.ANTROPIC_SECRET_KEY) process.env.ANTHROPIC_API_KEY = process.env.ANTROPIC_SECRET_KEY;

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Bez wartości zmiennych — tylko nazwy i komunikaty, żeby nie wyciekły sekrety.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Błędna konfiguracja środowiska (sprawdź .env, wzór w .env.example):\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;
export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
