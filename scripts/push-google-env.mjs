// Włącza „Kontynuuj z Google” na produkcji: GOOGLE_CLIENT_ID i GOOGLE_CLIENT_SECRET z
// .env.production.local (albo .env) → zmienne projektu Vercel (sekret jako Sensitive).
// Worker ich nie potrzebuje. Wartości nie są wypisywane. Po wszystkim: redeploy API.
// Użycie: node scripts/push-google-env.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const read = (f) => {
  const url = new URL(`../${f}`, import.meta.url);
  return existsSync(url) ? parseEnv(readFileSync(url, 'utf8')) : {};
};
const cfg = { ...read('.env'), ...read('.env.production.local') };
for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
  if (!cfg[k]) throw new Error(`Brak ${k} w .env.production.local`);
}
if (!cfg.GOOGLE_CLIENT_ID.endsWith('.apps.googleusercontent.com')) {
  throw new Error('GOOGLE_CLIENT_ID wygląda na niepoprawny (powinien kończyć się na .apps.googleusercontent.com)');
}

// Projekt readyou-rwyw; lokalny .vercel/ wskazuje inny projekt, więc zakres jest jawny.
const env = { ...process.env, VERCEL_ORG_ID: 'team_P5pld9FntbEGb5dyWTBFg3sU', VERCEL_PROJECT_ID: 'prj_KQKAYyk05UK7luJnUemWq3ksEzNs' };
const vercel = (args, input) =>
  execFileSync('npx', ['vercel', ...args], { env, input, stdio: ['pipe', 'ignore', 'pipe'], shell: process.platform === 'win32' });
for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
  try {
    vercel(['env', 'rm', k, 'production', '--yes']);
  } catch {
    // zmienna jeszcze nie istniała
  }
  vercel(['env', 'add', k, 'production', ...(k === 'GOOGLE_CLIENT_SECRET' ? ['--sensitive'] : [])], cfg[k]);
}
console.log('Vercel: GOOGLE_CLIENT_ID i GOOGLE_CLIENT_SECRET ustawione (production). Wymagany redeploy API.');
