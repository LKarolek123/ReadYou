// Włącza produkcyjną wysyłkę e-maili: bierze SMTP_* i EMAIL_FROM z .env.production.local, sprawdza
// logowanie do serwera SMTP, ustawia zmienne w Vercelu (API: reset hasła, weryfikacja adresu) i na
// serwerze (worker: raporty), a potem przeładowuje workera. Wartości nie są wypisywane.
// Użycie: node scripts/push-email-env.mjs [host-ssh]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import nodemailer from 'nodemailer';

const host = process.argv[2] ?? 'pulsego';
const cfg = parseEnv(readFileSync(new URL('../.env.production.local', import.meta.url), 'utf8'));
for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM']) {
  if (!cfg[k]) throw new Error(`Brak ${k} w .env.production.local`);
}
// Ten sam plik zasila worker.env (push-worker-env.mjs), więc dostawca musi być ustawiony właśnie tam.
if (cfg.EMAIL_PROVIDER !== 'smtp') throw new Error('Ustaw EMAIL_PROVIDER=smtp w .env.production.local');
if (/readyou\.local/.test(cfg.EMAIL_FROM)) throw new Error('EMAIL_FROM musi być prawdziwym adresem nadawcy');
if (cfg.SMTP_SECURE !== (cfg.SMTP_PORT === '465' ? 'true' : 'false')) {
  throw new Error('SMTP_SECURE: "true" dla portu 465, "false" dla 587 (STARTTLS)');
}

// 1. Logowanie do SMTP — bez tego nie ma sensu niczego zmieniać.
const secure = cfg.SMTP_SECURE === 'true';
await nodemailer
  .createTransport({ host: cfg.SMTP_HOST, port: Number(cfg.SMTP_PORT), secure, requireTLS: !secure, auth: { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } })
  .verify()
  .catch((err) => {
    throw new Error(`SMTP odrzucił połączenie/logowanie (${err.code ?? 'błąd'}): sprawdź host, port i hasło aplikacji`);
  });
console.log('SMTP: logowanie poprawne');

// 2. Vercel (projekt readyou-rwyw; lokalny .vercel/ wskazuje inny projekt, więc zakres jest jawny).
const vercelEnv = {
  ...process.env,
  VERCEL_ORG_ID: 'team_P5pld9FntbEGb5dyWTBFg3sU',
  VERCEL_PROJECT_ID: 'prj_KQKAYyk05UK7luJnUemWq3ksEzNs',
};
const vercel = (args, input) =>
  execFileSync('npx', ['vercel', ...args], { env: vercelEnv, input, stdio: ['pipe', 'ignore', 'pipe'], shell: process.platform === 'win32' });
for (const k of ['EMAIL_PROVIDER', 'EMAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS']) {
  try {
    vercel(['env', 'rm', k, 'production', '--yes']);
  } catch {
    // zmienna jeszcze nie istniała
  }
  vercel(['env', 'add', k, 'production', ...(k === 'SMTP_PASS' ? ['--sensitive'] : [])], cfg[k]);
}
console.log('Vercel: zmienne e-mail ustawione (production)');

// 3. Serwer: pełny worker.env (zawiera też SMTP_*) i przeładowanie kontenera z nowym env_file.
execFileSync('node', [fileURLToPath(new URL('./push-worker-env.mjs', import.meta.url)), host], { stdio: 'inherit' });
execFileSync('ssh', [host, 'cd /opt/readyou && docker compose up -d --force-recreate worker >/dev/null 2>&1 && docker compose ps --format "{{.Name}}: {{.Status}}"'], { stdio: ['ignore', 'inherit', 'inherit'] });
console.log('Gotowe. Wymagany redeploy API w Vercelu, żeby funkcja odczytała nowe zmienne.');
