import { Kysely, PostgresDialect, type ColumnType, type Generated, type JSONColumnType } from 'kysely';
import pg from 'pg';
import type { DfsState } from '@readyou/shared';
import { env } from './env.ts';

// NUMERIC i BIGINT jako liczby JS (wartości w tym projekcie są małe).
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;

/** Tabele Better Auth (camelCase, nazwy zarządzane przez bibliotekę). */
interface AuthUserTable {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface AuthAccountTable {
  id: string;
  userId: string;
  providerId: string;
}

interface UserProfileTable {
  user_id: string;
  city: string | null;
  timezone: Generated<string>;
  approx_lat: number | null;
  approx_lon: number | null;
  university: string | null;
  study_field: string | null;
  budget_currency: Generated<string>;
  budget_max_event_price: number | null;
  hours_per_week: number | null;
  available_days: Generated<string[]>;
  available_slots: Generated<string[]>;
  activity_types: Generated<string[]>;
  preferred_view: Generated<'grid' | 'swipe'>;
  onboarding_completed_at: NullableTimestamp;
  profile_version: Generated<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

interface OnboardingSessionTable {
  user_id: string;
  step: Generated<string>;
  dfs_state: JSONColumnType<DfsState> | null;
  updated_at: Timestamp;
}

interface InterestNodeTable {
  id: Generated<string>;
  key: string;
  label: string;
  normalized: string;
  parent_key: string | null;
  origin: 'taxonomy' | 'custom' | 'ai';
  created_at: Timestamp;
}

interface UserInterestTable {
  id: Generated<string>;
  user_id: string;
  node_key: string | null;
  label: string;
  normalized: string;
  path: Generated<string[]>;
  state: 'explicit' | 'learned' | 'excluded';
  origin: 'onboarding' | 'manual' | 'behavior';
  weight: Generated<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

interface ReportSubscriptionTable {
  user_id: string;
  enabled: Generated<boolean>;
  weekday: Generated<number>;
  local_time: Generated<string>;
  unsubscribe_token_hash: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface JobTable {
  id: Generated<string>;
  kind: string;
  payload: JSONColumnType<Record<string, unknown>, string, string>;
  dedupe_key: string | null;
  status: Generated<'queued' | 'running' | 'done' | 'failed'>;
  run_at: Timestamp;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  locked_by: string | null;
  locked_until: NullableTimestamp;
  last_error: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  finished_at: NullableTimestamp;
}

interface UserInterestEmbeddingTable {
  interest_id: string;
  user_id: string;
  model: string;
  dim: number;
  source_hash: string;
  profile_version: number;
  /** pgvector jako tekst `[0.1,0.2,…]`; zapis przez `toPgVector`. */
  embedding: string;
  created_at: Timestamp;
}

export interface Database {
  user: AuthUserTable;
  account: AuthAccountTable;
  user_profile: UserProfileTable;
  onboarding_session: OnboardingSessionTable;
  interest_node: InterestNodeTable;
  user_interest: UserInterestTable;
  report_subscription: ReportSubscriptionTable;
  job: JobTable;
  user_interest_embedding: UserInterestEmbeddingTable;
}

/** Wektor JS → literał pgvector. */
export const toPgVector = (v: readonly number[]) => `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;

export const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
