// Przesyła na serwer konfigurację workera (/opt/readyou/worker.env, chmod 600) złożoną z .env
// (klucze Anthropic i Brave) i .env.production.local (baza Supabase, ustawienia produkcji).
// Tylko potrzebne zmienne; wartości nie są wypisywane ani zapisywane lokalnie.
// Użycie: node scripts/push-worker-env.mjs [host-ssh]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const host = process.argv[2] ?? 'pulsego';
const read = (f) => parseEnv(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const merged = { ...read('.env'), ...read('.env.production.local') };
if (!merged.ANTHROPIC_API_KEY && merged.ANTROPIC_SECRET_KEY) merged.ANTHROPIC_API_KEY = merged.ANTROPIC_SECRET_KEY;

const keys = [
  'DATABASE_URL', 'DATABASE_CA_CERT', 'NODE_ENV', 'APP_URL', 'EMAIL_PROVIDER', 'EMAIL_FROM',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE',
  // BETTER_AUTH_SECRET celowo nie z .env (to sekret deweloperski) — produkcyjny ustawia
  // scripts/rotate-auth-secret.sh jednocześnie na serwerze i w Vercelu (podpis linków wypisu).
  'EMBEDDING_PROVIDER', 'DB_POOL_MAX', 'WORKER_POLL_MS',
  'ANTHROPIC_API_KEY', 'BRAVE_SEARCH_SECRET_KEY', 'CRAWLER_CONTACT',
];
for (const required of ['DATABASE_URL', 'ANTHROPIC_API_KEY', 'BRAVE_SEARCH_SECRET_KEY']) {
  if (!merged[required]) throw new Error(`Brak ${required} w .env / .env.production.local`);
}
if (/NOWE_HASLO|\[.*\]@/.test(merged.DATABASE_URL)) throw new Error('DATABASE_URL zawiera szablon hasła');

const body = keys.filter((k) => merged[k]).map((k) => `${k}=${merged[k].replace(/\n/g, '\\n')}`).join('\n') + '\n';
// Zachowuje BETTER_AUTH_SECRET już zapisany na serwerze.
const remote = 'umask 077 && mkdir -p /opt/readyou && cd /opt/readyou && { cat; grep -E "^BETTER_AUTH_SECRET=" worker.env 2>/dev/null || true; } > worker.env.new && mv worker.env.new worker.env && chmod 600 worker.env';
execFileSync('ssh', [host, remote], {
  input: body,
  stdio: ['pipe', 'inherit', 'inherit'],
});
console.log(`Przesłano ${keys.filter((k) => merged[k]).length} zmiennych do ${host}:/opt/readyou/worker.env`);
