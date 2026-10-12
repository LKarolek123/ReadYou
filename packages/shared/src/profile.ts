import { z } from 'zod';

export const ACTIVITY_TYPES = [
  { id: 'sport', label: 'Sport i ruch' },
  { id: 'social', label: 'Spotkania towarzyskie' },
  { id: 'tech', label: 'Technologia' },
  { id: 'culture', label: 'Kultura' },
  { id: 'calm', label: 'Spokojniejsze aktywności' },
  { id: 'outdoor', label: 'Na zewnątrz' },
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number]['id'];
const activityIds = ACTIVITY_TYPES.map((a) => a.id) as [ActivityType, ...ActivityType[]];

export const WEEKDAYS = [
  { id: 'mon', short: 'Pn' },
  { id: 'tue', short: 'Wt' },
  { id: 'wed', short: 'Śr' },
  { id: 'thu', short: 'Cz' },
  { id: 'fri', short: 'Pt' },
  { id: 'sat', short: 'Sb' },
  { id: 'sun', short: 'Nd' },
] as const;
export type Weekday = (typeof WEEKDAYS)[number]['id'];
const weekdayIds = WEEKDAYS.map((d) => d.id) as [Weekday, ...Weekday[]];

export const TIME_SLOTS = [
  { id: 'morning', label: 'Rano' },
  { id: 'afternoon', label: 'Popołudnie' },
  { id: 'evening', label: 'Wieczór' },
] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number]['id'];
const slotIds = TIME_SLOTS.map((t) => t.id) as [TimeSlot, ...TimeSlot[]];

/** Popularne kierunki — ogólne, bez wymuszania specjalizacji. Można wpisać własny. */
export const STUDY_FIELDS = [
  'Informatyka',
  'Matematyka',
  'Fizyka',
  'Medycyna',
  'Prawo',
  'Ekonomia',
  'Zarządzanie',
  'Psychologia',
  'Filologia',
  'Architektura',
  'Biologia',
  'Inżynieria',
] as const;

export const POLISH_CITIES = [
  'Warszawa', 'Kraków', 'Wrocław', 'Łódź', 'Poznań', 'Gdańsk', 'Szczecin', 'Lublin',
  'Bydgoszcz', 'Białystok', 'Katowice', 'Gdynia', 'Rzeszów', 'Toruń', 'Kielce', 'Olsztyn', 'Opole',
] as const;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('pl-PL', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const trimmed = (max: number) => z.string().trim().max(max);

/**
 * Budżet: `maxEventPrice === null` oznacza „brak informacji”, a 0 — „tylko bezpłatne”.
 * To dwa różne stany (spec. 3A).
 */
export const budgetSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).default('PLN'),
  maxEventPrice: z.number().int().min(0).max(100_000).nullable(),
});

export const availabilitySchema = z.object({
  hoursPerWeek: z.number().int().min(0).max(80).nullable(),
  days: z.array(z.enum(weekdayIds)).max(7).default([]),
  slots: z.array(z.enum(slotIds)).max(3).default([]),
});

export const profilePatchSchema = z
  .object({
    city: trimmed(80).min(1).nullable(),
    timezone: z.string().refine(isValidTimeZone, 'Nieznana strefa czasowa'),
    approxLat: z.number().min(-90).max(90).nullable(),
    approxLon: z.number().min(-180).max(180).nullable(),
    university: trimmed(120).nullable(),
    studyField: trimmed(80).nullable(),
    budget: budgetSchema,
    availability: availabilitySchema,
    activityTypes: z.array(z.enum(activityIds)).max(ACTIVITY_TYPES.length),
    preferredView: z.enum(['grid', 'swipe']),
  })
  .partial();
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export interface Profile {
  city: string | null;
  timezone: string;
  approxLat: number | null;
  approxLon: number | null;
  university: string | null;
  studyField: string | null;
  budget: z.infer<typeof budgetSchema>;
  availability: z.infer<typeof availabilitySchema>;
  activityTypes: ActivityType[];
  preferredView: 'grid' | 'swipe';
  onboardingCompleted: boolean;
  profileVersion: number;
}

export type InterestState = 'explicit' | 'learned' | 'excluded';

export interface Interest {
  id: string;
  label: string;
  normalized: string;
  state: InterestState;
  origin: 'onboarding' | 'manual' | 'behavior';
  path: string[];
  nodeId: string | null;
  weight: number;
  createdAt: string;
}

export const addInterestSchema = z.object({
  label: z.string().trim().min(1).max(60),
  state: z.enum(['explicit', 'excluded']).default('explicit'),
  sense: z.string().max(80).optional(),
});

export const patchInterestSchema = z.object({
  state: z.enum(['explicit', 'excluded']),
});

export const reportSubscriptionPatchSchema = z
  .object({
    enabled: z.boolean(),
    weekday: z.number().int().min(1).max(7), // ISO: 1 = poniedziałek … 5 = piątek
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .partial();

export interface ReportSubscription {
  enabled: boolean;
  weekday: number;
  localTime: string;
  timezone: string;
  emailVerified: boolean;
  nextSendAt: string | null;
}

/** Kroki onboardingu (spec. 3A). `deepen` to pogłębianie DFS, `done` — zakończony. */
export const ONBOARDING_STEPS = [
  'location',
  'studies',
  'budget',
  'activities',
  'interests',
  'deepen',
  'tags',
  'report',
  'done',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const DEFAULT_TIMEZONE = 'Europe/Warsaw';
export const DEFAULT_REPORT_WEEKDAY = 5;
export const DEFAULT_REPORT_TIME = '20:00';
