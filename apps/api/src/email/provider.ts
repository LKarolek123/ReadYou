import nodemailer from 'nodemailer';
import { env } from '../env.ts';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Klucz idempotencji przekazywany dostawcy, jeśli go obsługuje. */
  idempotencyKey?: string;
}

export interface EmailProvider {
  readonly name: string;
  /** Czy wiadomości trafiają do realnych skrzynek (false = lokalne przechwytywanie). */
  readonly deliversToRealRecipients: boolean;
  send(message: EmailMessage): Promise<{ providerMessageId: string | null }>;
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
    const info = await this.transport.sendMail({
      from: env.EMAIL_FROM,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      headers: m.idempotencyKey ? { 'X-Idempotency-Key': m.idempotencyKey } : undefined,
    });
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

export const emailProvider: EmailProvider =
  env.EMAIL_PROVIDER === 'smtp-dev' ? new SmtpDevProvider() : new DisabledProvider();

/** Wysyłka „fire and forget” dla e-maili auth (zalecenie Better Auth: bez await, przeciw timing attacks). */
export function sendInBackground(message: EmailMessage, log: (err: unknown) => void) {
  emailProvider.send(message).catch(log);
}
