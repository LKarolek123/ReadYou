import { sql } from 'kysely';
import type { ActivityType, Profile, ProfilePatch, TimeSlot, Weekday } from '@readyou/shared';
import { db } from '../db.ts';
import { ensureUserRows } from '../auth.ts';
import { scheduleInterestEmbeddings } from './embeddings.ts';

/** Zaokrąglenie do ~1 km — nie przechowujemy dokładnej lokalizacji. */
const roundCoord = (v: number | null | undefined) => (v == null ? v : Math.round(v * 100) / 100);

export async function getProfile(userId: string): Promise<Profile> {
  let row = await db.selectFrom('user_profile').selectAll().where('user_id', '=', userId).executeTakeFirst();
  if (!row) {
    // Konto z Google utworzone przed hookiem lub po ręcznym czyszczeniu — uzupełniamy idempotentnie.
    await ensureUserRows(userId);
    row = await db.selectFrom('user_profile').selectAll().where('user_id', '=', userId).executeTakeFirstOrThrow();
  }
  return {
    city: row.city,
    timezone: row.timezone,
    approxLat: row.approx_lat,
    approxLon: row.approx_lon,
    university: row.university,
    studyField: row.study_field,
    budget: { currency: row.budget_currency, maxEventPrice: row.budget_max_event_price },
    availability: {
      hoursPerWeek: row.hours_per_week,
      days: row.available_days as Weekday[],
      slots: row.available_slots as TimeSlot[],
    },
    activityTypes: row.activity_types as ActivityType[],
    preferredView: row.preferred_view,
    onboardingCompleted: row.onboarding_completed_at !== null,
    profileVersion: row.profile_version,
  };
}

export async function patchProfile(userId: string, patch: ProfilePatch): Promise<Profile> {
  await getProfile(userId); // gwarantuje istnienie wiersza
  const values: Record<string, unknown> = {};
  if (patch.city !== undefined) values.city = patch.city;
  if (patch.timezone !== undefined) values.timezone = patch.timezone;
  if (patch.approxLat !== undefined) values.approx_lat = roundCoord(patch.approxLat);
  if (patch.approxLon !== undefined) values.approx_lon = roundCoord(patch.approxLon);
  if (patch.university !== undefined) values.university = patch.university || null;
  if (patch.studyField !== undefined) values.study_field = patch.studyField || null;
  if (patch.budget) {
    values.budget_currency = patch.budget.currency;
    values.budget_max_event_price = patch.budget.maxEventPrice;
  }
  if (patch.availability) {
    values.hours_per_week = patch.availability.hoursPerWeek;
    values.available_days = patch.availability.days;
    values.available_slots = patch.availability.slots;
  }
  if (patch.activityTypes) values.activity_types = patch.activityTypes;
  if (patch.preferredView) values.preferred_view = patch.preferredView;

  if (Object.keys(values).length > 0) {
    // Zmiana widoku nie wpływa na rekomendacje — nie podbija wersji profilu.
    const affectsRanking = Object.keys(values).some((k) => k !== 'preferred_view');
    await db
      .updateTable('user_profile')
      .set({
        ...values,
        updated_at: new Date(),
        ...(affectsRanking ? { profile_version: sql<number>`profile_version + 1` } : {}),
      })
      .where('user_id', '=', userId)
      .execute();
  }
  return getProfile(userId);
}

/** Podbija wersję profilu po zmianie zainteresowań i zleca przeliczenie ich wektorów. */
export async function bumpProfileVersion(userId: string) {
  await db
    .updateTable('user_profile')
    .set({ profile_version: sql<number>`profile_version + 1`, updated_at: new Date() })
    .where('user_id', '=', userId)
    .execute();
  await scheduleInterestEmbeddings(userId);
}
