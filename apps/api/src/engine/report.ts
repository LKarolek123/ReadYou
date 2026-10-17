/**
 * Raport tygodniowy: generacja (zapis) → outbox (`email_delivery`) → wysyłka.
 *
 * Harmonogram: domyślnie piątek 20:00 w strefie osoby (czas ścienny, poprawnie przez zmiany czasu).
 * Raport powstaje ~45 min przed terminem; wysyłka ma termin `scheduled_for`.
 *
 * Gwarancje dostarczenia:
 * - unikalny raport na (osoba, okres) i unikalna wysyłka na (raport, kanał) — retry nie tworzy duplikatu,
 * - przed wysyłką ponownie sprawdzamy zapis, konto i zweryfikowany adres,
 * - przejęcie wysyłki to atomowa zmiana `pending → sending`; dwa workery nie wyślą jej dwa razy,
 * - błąd przed przekazaniem wiadomości serwerowi (połączenie, DNS, logowanie) = bezpieczne ponowienie;
 *   każdy inny błąd = wynik NIEPEWNY (`uncertain`) — nie wysyłamy ślepo drugi raz (najwyżej raz, nie
 *   „dokładnie raz”: przy zerwanym połączeniu po przyjęciu przez serwer osoba może nie dostać raportu),
 * - wysyłka „utknięta” w `sending` > 30 min (awaria procesu) przechodzi w `uncertain`,
 * - opóźnienie > REPORT_MAX_DELAY_HOURS (np. worker wyłączony) = `skipped`: nie wysyłamy piątkowego
 *   raportu w niedzielę; raport zostaje w archiwum.
 */
import { createHash, createHmac } from 'node:crypto';
import { DateTime } from 'luxon';
import { sql } from 'kysely';
import { cosine, ProviderNotConfiguredError, type ReportSynthesizer } from '@readyou/providers';
import { nextReportAt, type ArticleCard, type ReportContent, type ReportItem } from '@readyou/shared';
import { db, fromPgVector } from '../db.ts';
import { env } from '../env.ts';
import { emailProvider, isSafeToRetry } from '../email/provider.ts';
import { reportEmail } from '../email/report-template.ts';
import { enqueue, RetryLaterError } from '../jobs/queue.ts';
import { loadCards } from '../services/content.ts';
import { eventFeed } from '../services/events.ts';
import { estimateCostUsd, reserveLlm, settleLlm } from './llm-budget.ts';
import { mostSpecific } from './learning.ts';

export const REPORT_JOBS = { generate: 'generate_report', send: 'send_report' } as const;
export const MAX_ITEMS = 10;
const MAX_NEWS = 6;
const MAX_EVENTS = 4;
const SAME_STORY_SIM = 0.9;
/** Ile przed terminem przygotowujemy raport (aktualność vs zapas na awarie). */
export const PREPARE_LEAD_MIN = 45;
const STUCK_SENDING_MIN = 30;
const DAY_MS = 86_400_000;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Nieprzezroczysty token wypisu: HMAC sekretu serwera i identyfikatora osoby. Nie zdradza konta,
 * pozwala wyłącznie wyłączyć raport; w bazie trzymamy tylko jego hash.
 */
export function unsubscribeToken(userId: string): string {
  return createHmac('sha256', env.BETTER_AUTH_SECRET).update(`readyou:unsubscribe:v1:${userId}`).digest('base64url');
}
export const unsubscribeHash = (token: string) => sha(`unsub:${token}`);

/** Okres raportu: tydzień ISO terminu w strefie osoby; treści z 7 dni przed terminem. */
export function reportPeriod(scheduledFor: Date, tz: string) {
  const local = DateTime.fromJSDate(scheduledFor).setZone(tz);
  return {
    key: local.toFormat("kkkk-'W'WW"),
    start: new Date(scheduledFor.getTime() - 7 * DAY_MS),
    end: scheduledFor,
    label: `${local.minus({ days: 7 }).setLocale('pl').toFormat('d MMMM')} – ${local.setLocale('pl').toFormat('d MMMM yyyy')}`,
  };
}

// ---------------------------------------------------------------- dobór pozycji

interface Candidate {
  id: string;
  why: string;
  section: ReportItem['section'];
  when?: string | null;
  allDay?: boolean;
  ongoing?: boolean;
}

/** Najwyżej tyle pozycji o tym samym temacie (tag streszczenia) — raport nie może być „tygodniem Tesli”. */
const MAX_PER_TOPIC = 2;

/** Koniec całodniowego jest wyłączny (północ następnego dnia) — „trwa do” pokazuje ostatni dzień. */
const lastDay = (endsAt: string, allDay: boolean) => (allDay ? new Date(new Date(endsAt).getTime() - 1).toISOString() : endsAt);

/** Temat pozycji: najbardziej szczegółowy tag jej streszczenia. */
async function topics(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.selectFrom('summary').select(['content_id', 'tags', 'created_at']).where('content_id', 'in', ids).where('sufficient', '=', true).orderBy('created_at', 'desc').execute();
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.content_id) && r.tags.length) out.set(r.content_id, mostSpecific(r.tags)[0] ?? r.tags[0]!);
  return out;
}

async function vectors(ids: string[]): Promise<Map<string, number[]>> {
  if (!ids.length) return new Map();
  const rows = await db.selectFrom('content_embedding').select(['content_id', sql<string>`embedding::text`.as('v')]).where('content_id', 'in', ids).execute();
  return new Map(rows.map((r) => [r.content_id, fromPgVector(r.v)]));
}

/**
 * Do 10 różnych pozycji: najpierw polubione i nieprzeczytane z tygodnia, potem najlepsze z dziennych pul,
 * potem 1–2 najszerzej opisywane historie z Polski (Trending, ≥ 3 niezależne źródła); wydarzenia na
 * kolejne 7 dni (z weekendem) i bliskie terminy zapisów. Pominięte i przeczytane nie wracają; ta sama
 * historia tylko raz. Brak dopełniania słabymi treściami.
 */
export async function selectReportItems(userId: string, start: Date, end: Date): Promise<Candidate[]> {
  const excluded = new Set(
    (
      await db
        .selectFrom('user_content_state')
        .select('content_id')
        .where('user_id', '=', userId)
        .where((eb) => eb.or([eb('read_at', 'is not', null), eb('skipped_at', 'is not', null)]))
        .execute()
    ).map((r) => r.content_id),
  );
  const withSummary = sql<boolean>`exists (select 1 from summary sm where sm.content_id = c.id and sm.sufficient)`;
  const liked = await db
    .selectFrom('user_content_state as s')
    .innerJoin('content_item as c', 'c.id', 's.content_id')
    .select('c.id')
    .where('s.user_id', '=', userId)
    .where('s.liked_at', '>=', start)
    .where('s.liked_at', '<', end)
    .where('s.read_at', 'is', null)
    .where('c.kind', 'in', ['article', 'news'])
    .orderBy('s.liked_at', 'desc')
    .execute();
  const pool = await db
    .selectFrom('daily_assignment as a')
    .innerJoin('content_item as c', 'c.id', 'a.content_id')
    .select('c.id')
    .where('a.user_id', '=', userId)
    .where('a.created_at', '>=', start)
    .where('a.created_at', '<', end)
    .where(withSummary)
    .orderBy('a.score', 'desc')
    .limit(40)
    .execute();
  const snap = await db.selectFrom('trending_snapshot').select('id').where('kind', '=', 'news').where('created_at', '<=', end).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
  const national = snap
    ? await db.selectFrom('trending_item').select(['content_id', 'independent_sources']).where('snapshot_id', '=', snap.id).where('independent_sources', '>=', 3).orderBy('rank').limit(2).execute()
    : [];

  const news: Candidate[] = [
    ...liked.map((r) => ({ id: r.id, why: 'Polubione, jeszcze nieprzeczytane', section: 'news' as const })),
    ...pool.map((r) => ({ id: r.id, why: 'Z Twojej dziennej puli', section: 'news' as const })),
    ...national.map((r) => ({ id: r.content_id, why: `Ważne w Polsce — ${r.independent_sources} niezależne źródła`, section: 'news' as const })),
  ];
  const vec = await vectors(news.map((n) => n.id));
  const topicOf = await topics(news.map((n) => n.id));
  const perTopic = new Map<string, number>();
  const chosen: Candidate[] = [];
  const chosenVecs: number[][] = [];
  for (const n of news) {
    if (chosen.length >= MAX_NEWS) break;
    if (excluded.has(n.id) || chosen.some((c) => c.id === n.id)) continue;
    const v = vec.get(n.id);
    if (v && chosenVecs.some((c) => cosine(c, v) >= SAME_STORY_SIM)) continue; // ta sama historia z innego źródła
    const topic = topicOf.get(n.id);
    if (topic && (perTopic.get(topic) ?? 0) >= MAX_PER_TOPIC) continue;
    chosen.push(n);
    if (v) chosenVecs.push(v);
    if (topic) perTopic.set(topic, (perTopic.get(topic) ?? 0) + 1);
  }

  // Wydarzenia: od terminu raportu przez 7 dni (lista „tydzień” sięga do poniedziałku, „nadchodzące” dalej).
  const horizon = new Date(end.getTime() + 7 * DAY_MS);
  const [week, upcoming] = await Promise.all([eventFeed(userId, 'week'), eventFeed(userId, 'upcoming')]);
  const events: Candidate[] = [];
  const deadlines: Candidate[] = [];
  for (const c of [...week.items, ...upcoming.items]) {
    if (excluded.has(c.id) || !c.event || events.some((e) => e.id === c.id) || deadlines.some((e) => e.id === c.id)) continue;
    const startsAt = c.event.startsAt ? new Date(c.event.startsAt) : null;
    const reg = c.event.registration.endsAt ? new Date(c.event.registration.endsAt) : null;
    if (reg && reg >= end && reg < horizon && deadlines.length < 2) {
      deadlines.push({ id: c.id, section: 'deadlines', why: c.why?.reasons?.[0] ?? 'Bliski termin zapisów', when: reg.toISOString() });
    } else if (startsAt && startsAt < horizon && events.length < MAX_EVENTS) {
      // Trwające (np. wystawa otwarta w kwietniu): pokazujemy koniec, a nie datę otwarcia sprzed miesięcy.
      const ongoing = startsAt < end && Boolean(c.event.endsAt);
      events.push({ id: c.id, section: 'events', why: c.why?.interest ? `Pasuje do: ${c.why.interest}` : 'W Twoim mieście', when: ongoing ? lastDay(c.event.endsAt!, c.event.allDay) : c.event.startsAt, allDay: c.event.allDay, ongoing });
    }
  }
  return [...chosen, ...events, ...deadlines].slice(0, MAX_ITEMS);
}

// ---------------------------------------------------------------- synteza i treść

async function synthesize(synth: ReportSynthesizer | null, items: ReportItem[], label: string): Promise<{ intro: string | null; changes: ReportContent['changes']; model: string | null }> {
  const news = items.filter((i) => i.section === 'news');
  if (!synth || news.length < 2) return { intro: null, changes: [], model: null };
  const sums = await db.selectFrom('summary').select(['content_id', 'summary', 'key_facts', 'created_at']).where('content_id', 'in', news.map((n) => n.contentId)).where('sufficient', '=', true).orderBy('created_at', 'desc').execute();
  const byId = new Map<string, (typeof sums)[number]>();
  for (const s of sums) if (!byId.has(s.content_id)) byId.set(s.content_id, s);
  const material = news.map((n, i) => ({ id: `p${i + 1}`, contentId: n.contentId, title: n.title, source: n.source, date: n.publishedAt?.slice(0, 10) ?? null, summary: byId.get(n.contentId)?.summary ?? n.description, keyFacts: byId.get(n.contentId)?.key_facts ?? [] }));
  const reserved = estimateCostUsd(Math.ceil(JSON.stringify(material).length / 3.5) + 800, 1200);
  if (!(await reserveLlm(synth.model, reserved))) return { intro: null, changes: [], model: null };
  try {
    const { synthesis, usage } = await synth.synthesize(material, label);
    await settleLlm(synth.model, reserved, usage);
    const toContent = new Map(material.map((m) => [m.id, m.contentId]));
    return { intro: synthesis.intro || null, changes: synthesis.changes.map((c) => ({ text: c.text, itemIds: c.item_ids.map((id) => toContent.get(id)!) })), model: synth.model };
  } catch (e) {
    await settleLlm(synth.model, reserved, null);
    if (e instanceof ProviderNotConfiguredError) return { intro: null, changes: [], model: null };
    // Synteza jest dodatkiem — awaria modelu nie blokuje raportu (bez syntezy, uczciwie).
    console.warn(JSON.stringify({ level: 'warn', msg: 'Synteza raportu nieudana', error: (e as Error).message }));
    return { intro: null, changes: [], model: null };
  }
}

function toItem(c: Candidate, card: ArticleCard): ReportItem {
  return {
    contentId: card.id,
    section: c.section,
    title: card.title,
    description: card.description,
    url: card.url,
    source: card.source,
    publishedAt: card.publishedAt,
    why: c.why,
    when: c.when ?? null,
    ...(c.allDay ? { allDay: true } : {}),
    ...(c.ongoing ? { ongoing: true } : {}),
  };
}

export async function generateReport(userId: string, scheduledFor: Date, synth: ReportSynthesizer | null) {
  const profile = await db.selectFrom('user_profile').select('timezone').where('user_id', '=', userId).executeTakeFirst();
  if (!profile) return { skipped: 'brak profilu' };
  const period = reportPeriod(scheduledFor, profile.timezone);
  const existing = await db.selectFrom('weekly_report').select('id').where('user_id', '=', userId).where('period_key', '=', period.key).executeTakeFirst();
  if (existing) return { reportId: existing.id, existing: true }; // ponowienie zadania nie tworzy drugiego raportu

  const candidates = await selectReportItems(userId, period.start, period.end);
  const cards = await loadCards(userId, candidates.map((c) => c.id));
  const items = candidates.flatMap((c) => (cards.get(c.id) ? [toItem(c, cards.get(c.id)!)] : []));
  const s = await synthesize(synth, items, period.label);
  const nNews = items.filter((i) => i.section === 'news').length;
  const nEvents = items.length - nNews;
  const content: ReportContent = {
    periodLabel: period.label,
    intro:
      s.intro ??
      (items.length
        ? `Wybraliśmy ${nNews ? `${nNews} ${nNews === 1 ? 'tekst' : nNews < 5 ? 'teksty' : 'tekstów'}` : ''}${nNews && nEvents ? ' i ' : ''}${nEvents ? `${nEvents} ${nEvents === 1 ? 'wydarzenie' : nEvents < 5 ? 'wydarzenia' : 'wydarzeń'}` : ''} na podstawie Twoich zainteresowań.`
        : 'W tym tygodniu nie znaleźliśmy treści wystarczająco trafnych i wiarygodnych, by je polecić.'),
    changes: s.changes,
    items,
  };
  const token = unsubscribeToken(userId);
  const email = reportEmail(content, {
    appUrl: env.APP_URL,
    settingsUrl: `${env.APP_URL}/profile`,
    unsubscribeUrl: `${env.APP_URL}/api/unsubscribe?token=${encodeURIComponent(token)}`,
    timezone: profile.timezone,
  });
  const status = items.length ? 'ready' : 'empty';
  const reportId = await db.transaction().execute(async (trx) => {
    const row = await trx
      .insertInto('weekly_report')
      .values({
        user_id: userId,
        period_key: period.key,
        period_start: period.start,
        period_end: period.end,
        scheduled_for: scheduledFor,
        status,
        subject: email.subject,
        content: JSON.stringify(content),
        html: email.html,
        text: email.text,
        synthesis_model: s.model,
        generated_at: new Date(),
      })
      .onConflict((oc) => oc.columns(['user_id', 'period_key']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!row) return null; // równoległe zadanie już zapisało raport
    await trx
      .insertInto('email_delivery')
      .values({
        report_id: row.id,
        user_id: userId,
        idempotency_key: `report:${userId}:${period.key}:email`,
        // Pusty raport nie jest wysyłany (zostaje w archiwum z informacją).
        status: status === 'empty' ? 'skipped' : 'pending',
        last_error: status === 'empty' ? 'brak treści do polecenia' : null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
    await trx.updateTable('report_subscription').set({ unsubscribe_token_hash: unsubscribeHash(token) }).where('user_id', '=', userId).execute();
    return row.id;
  });
  if (!reportId) return { skipped: 'raport już istnieje' };
  const delivery = await db.selectFrom('email_delivery').select(['id', 'status']).where('report_id', '=', reportId).executeTakeFirstOrThrow();
  if (delivery.status === 'pending') {
    await enqueue(REPORT_JOBS.send, { deliveryId: delivery.id }, { dedupeKey: `${REPORT_JOBS.send}:${delivery.id}`, runAt: scheduledFor });
  }
  return { reportId, items: items.length, synthesis: Boolean(s.model), status };
}

// ---------------------------------------------------------------- wysyłka

async function mark(id: string, patch: { status: 'pending' | 'sent' | 'failed' | 'uncertain' | 'skipped'; last_error?: string | null; sent_at?: Date; provider?: string; provider_message_id?: string | null }) {
  await db.updateTable('email_delivery').set({ ...patch, updated_at: new Date() }).where('id', '=', id).execute();
}

export async function sendReport(deliveryId: string, now = new Date()) {
  const d = await db
    .selectFrom('email_delivery as d')
    .innerJoin('weekly_report as r', 'r.id', 'd.report_id')
    .innerJoin('user as u', 'u.id', 'd.user_id')
    .leftJoin('report_subscription as s', 's.user_id', 'd.user_id')
    .select(['d.id', 'd.status', 'd.idempotency_key', 'r.subject', 'r.html', 'r.text', 'r.scheduled_for', 'u.email', 'u.emailVerified', 's.enabled', 'd.user_id'])
    .where('d.id', '=', deliveryId)
    .executeTakeFirst();
  if (!d) return { skipped: 'brak wysyłki (konto usunięte?)' };
  if (d.status !== 'pending') return { skipped: `status ${d.status}` };
  // Ponowne sprawdzenie tuż przed wysyłką: wypis, weryfikacja adresu, opóźnienie.
  if (!d.enabled) return mark(d.id, { status: 'skipped', last_error: 'wypisano z raportu' }).then(() => ({ status: 'skipped' }));
  if (!d.emailVerified) return mark(d.id, { status: 'skipped', last_error: 'adres niezweryfikowany' }).then(() => ({ status: 'skipped' }));
  if (now.getTime() - d.scheduled_for.getTime() > env.REPORT_MAX_DELAY_HOURS * 3_600_000) {
    return mark(d.id, { status: 'skipped', last_error: `opóźnienie ponad ${env.REPORT_MAX_DELAY_HOURS} h` }).then(() => ({ status: 'skipped' }));
  }
  // Atomowe przejęcie: tylko jeden worker przechodzi pending → sending.
  const claimed = await db
    .updateTable('email_delivery')
    .set({ status: 'sending', attempts: sql<number>`attempts + 1`, updated_at: new Date() })
    .where('id', '=', d.id)
    .where('status', '=', 'pending')
    .returning('id')
    .executeTakeFirst();
  if (!claimed) return { skipped: 'przejęte przez inny proces' };
  const token = unsubscribeToken(d.user_id);
  const unsubscribe = `${env.APP_URL}/api/unsubscribe?token=${encodeURIComponent(token)}`;
  try {
    const res = await emailProvider.send({
      to: d.email,
      subject: d.subject,
      html: d.html,
      text: d.text,
      idempotencyKey: d.idempotency_key,
      // RFC 8058: wypis jednym kliknięciem z poziomu klienta poczty.
      headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
    await mark(d.id, { status: 'sent', sent_at: new Date(), provider: emailProvider.name, provider_message_id: res.providerMessageId, last_error: null });
    return { status: 'sent', provider: emailProvider.name };
  } catch (e) {
    const message = (e as Error).message.slice(0, 300);
    if (isSafeToRetry(e)) {
      await mark(d.id, { status: 'pending', last_error: message });
      throw new RetryLaterError(`Wysyłka do ponowienia: ${message}`, 5 * 60_000);
    }
    await mark(d.id, { status: 'uncertain', last_error: `wynik nieznany: ${message}` });
    return { status: 'uncertain' };
  }
}

// ---------------------------------------------------------------- harmonogram i wypis

/**
 * Co 10 min: dla osób z włączonym raportem i zweryfikowanym adresem — zadanie generacji, gdy do terminu
 * zostało ≤ 60 min (albo termin minął niedawno, np. po restarcie). Deduplikacja per osoba i okres.
 */
export async function scheduleReports(now = new Date()) {
  await db
    .updateTable('email_delivery')
    .set({ status: 'uncertain', last_error: 'przerwane w trakcie wysyłki (proces zatrzymany)', updated_at: now })
    .where('status', '=', 'sending')
    .where('updated_at', '<', new Date(now.getTime() - STUCK_SENDING_MIN * 60_000))
    .execute();
  const subs = await db
    .selectFrom('report_subscription as s')
    .innerJoin('user as u', 'u.id', 's.user_id')
    .innerJoin('user_profile as p', 'p.user_id', 's.user_id')
    .select(['s.user_id', 's.weekday', 's.local_time', 'p.timezone'])
    .where('s.enabled', '=', true)
    .where('u.emailVerified', '=', true)
    .execute();
  let queued = 0;
  for (const s of subs) {
    const due = nextReportAt(new Date(now.getTime() - env.REPORT_MAX_DELAY_HOURS * 3_600_000), s.timezone, s.weekday, s.local_time);
    if (due.getTime() - now.getTime() > 60 * 60_000) continue;
    const period = reportPeriod(due, s.timezone);
    const runAt = new Date(Math.max(now.getTime(), due.getTime() - PREPARE_LEAD_MIN * 60_000));
    await enqueue(REPORT_JOBS.generate, { userId: s.user_id, scheduledFor: due.toISOString() }, { dedupeKey: `${REPORT_JOBS.generate}:${s.user_id}:${period.key}`, runAt });
    queued++;
  }
  return queued;
}

/** Wypis tokenem z e-maila: tylko wyłącza raport (bez dostępu do profilu). Zwraca, czy token był poprawny. */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return false;
  const res = await db
    .updateTable('report_subscription')
    .set({ enabled: false, updated_at: new Date() })
    .where('unsubscribe_token_hash', '=', unsubscribeHash(token))
    .returning('user_id')
    .executeTakeFirst();
  if (!res) return false;
  await db.updateTable('email_delivery').set({ status: 'skipped', last_error: 'wypisano z raportu', updated_at: new Date() }).where('user_id', '=', res.user_id).where('status', '=', 'pending').execute();
  return true;
}
