import nodemailer from 'nodemailer';
import { env } from '../env.ts';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Klucz idempotencji przekazywany dostawcy, jeśli go obsługuje. */
  idempotencyKey?: string;
  /** Dodatkowe nagłówki (np. List-Unsubscribe). */
  headers?: Record<string, string>;
}

export interface EmailProvider {
  readonly name: string;
  /** Czy wiadomości trafiają do realnych skrzynek (false = lokalne przechwytywanie). */
  readonly deliversToRealRecipients: boolean;
  send(message: EmailMessage): Promise<{ providerMessageId: string | null }>;
}

/**
 * Błąd przed przekazaniem wiadomości serwerowi (brak połączenia, DNS, logowanie) — wiadomość na pewno
 * nie wyszła, więc ponowienie jest bezpieczne. Każdy inny błąd (np. przerwanie w trakcie DATA, timeout
 * odpowiedzi) oznacza wynik NIEPEWNY: serwer mógł już przyjąć wiadomość.
 */
export function isSafeToRetry(err: unknown): boolean {
  const e = err as { code?: string; command?: string; responseCode?: number };
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EAUTH', 'ECONNECTION', 'EDNS'].includes(e.code ?? '')) return true;
  // Odrzucenie przed DATA (np. 4xx/5xx na MAIL FROM / RCPT TO) — serwer niczego nie przyjął.
  if (e.command && ['CONN', 'EHLO', 'HELO', 'AUTH PLAIN', 'AUTH LOGIN', 'MAIL FROM', 'RCPT TO'].includes(e.command)) return true;
  return false;
}

function sendVia(transport: ReturnType<typeof nodemailer.createTransport>, m: EmailMessage) {
  return transport.sendMail({
    from: env.EMAIL_FROM,
    to: m.to,
    subject: m.subject,
    html: m.html,
    text: m.text,
    headers: { ...(m.idempotencyKey ? { 'X-Idempotency-Key': m.idempotencyKey } : {}), ...(m.headers ?? {}) },
  });
}

/**
 * Tryb developerski: SMTP do lokalnego Mailpit (http://127.0.0.1:8025).
 * Odmawia wysyłki na host inny niż lokalny, żeby dev nigdy nie trafił do realnych osób.
 */
class SmtpDevProvider implements EmailProvider {
  readonly name = 'smtp-dev';
  readonly deliversToRealRecipients = false;
  private transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false,
    ignoreTLS: true,
  });

  constructor() {
    if (!['127.0.0.1', 'localhost', 'mailpit'].includes(env.SMTP_HOST)) {
      throw new Error('EMAIL_PROVIDER=smtp-dev wymaga lokalnego SMTP (Mailpit)');
    }
  }

  async send(m: EmailMessage) {
    const info = await sendVia(this.transport, m);
    return { providerMessageId: info.messageId ?? null };
  }
}

/**
 * Produkcja: dowolny dostawca z SMTP (np. usługa transakcyjna z uwierzytelnionym nadawcą — SPF/DKIM).
 * Wymaga jawnej konfiguracji nadawcy i TLS. Większość usług SMTP nie ma klucza idempotencji, więc
 * gwarancją jest nasz outbox: co najwyżej jedna próba po niepewnym wyniku (patrz docs/architecture.md).
 */
class SmtpProvider implements EmailProvider {
  readonly name = 'smtp';
  readonly deliversToRealRecipients = true;
  private transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    requireTLS: !env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });

  constructor() {
    if (!env.SMTP_USER || !env.SMTP_PASS) throw new Error('EMAIL_PROVIDER=smtp wymaga SMTP_USER i SMTP_PASS');
    if (/readyou\.local/.test(env.EMAIL_FROM)) throw new Error('EMAIL_PROVIDER=smtp wymaga prawdziwego nadawcy w EMAIL_FROM');
  }

  async send(m: EmailMessage) {
    const info = await sendVia(this.transport, m);
    return { providerMessageId: info.messageId ?? null };
  }
}

class DisabledProvider implements EmailProvider {
  readonly name = 'disabled';
  readonly deliversToRealRecipients = false;
  async send(m: EmailMessage): Promise<{ providerMessageId: null }> {
    console.warn(`[email] wysyłka wyłączona — pominięto wiadomość „${m.subject}”`);
    return { providerMessageId: null };
  }
}

function create(): EmailProvider {
  if (env.EMAIL_PROVIDER === 'smtp-dev') return new SmtpDevProvider();
  if (env.EMAIL_PROVIDER === 'smtp') return new SmtpProvider();
  return new DisabledProvider();
}

export let emailProvider: EmailProvider = create();

/** Tylko testy: podmiana dostawcy (np. atrapa zapisująca wiadomości albo symulująca awarię). */
export function setEmailProviderForTests(p: EmailProvider) {
  emailProvider = p;
}

/** Wysyłka „fire and forget” dla e-maili auth (zalecenie Better Auth: bez await, przeciw timing attacks). */
export function sendInBackground(message: EmailMessage, log: (err: unknown) => void) {
  emailProvider.send(message).catch(log);
}
