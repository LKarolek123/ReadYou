import { DateTime } from 'luxon';

/**
 * Najbliższy termin raportu w lokalnej strefie użytkownika, zwrócony jako chwila UTC.
 * 20:00 to czas ścienny w strefie IANA — nie stały offset UTC, więc działa poprawnie
 * przez zmiany czasu letniego/zimowego.
 *
 * @param weekday ISO 1–7 (5 = piątek)
 * @param localTime "HH:mm"
 */
export function nextReportAt(now: Date, timezone: string, weekday: number, localTime: string): Date {
  const [h, m] = localTime.split(':').map(Number) as [number, number];
  const local = DateTime.fromJSDate(now, { zone: timezone });
  let candidate = local.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  const delta = (weekday - candidate.weekday + 7) % 7;
  candidate = candidate.plus({ days: delta });
  if (candidate <= local) candidate = candidate.plus({ weeks: 1 });
  return candidate.toUTC().toJSDate();
}

const WEEKDAY_NAMES = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];

export function weekdayName(isoWeekday: number): string {
  return WEEKDAY_NAMES[isoWeekday - 1] ?? '';
}
