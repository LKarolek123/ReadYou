import { Kysely, PostgresDialect, type ColumnType, type Generated, type JSONColumnType } from 'kysely';
import pg from 'pg';
import type { DfsState } from '@readyou/shared';
import { env } from './env.ts';

// NUMERIC i BIGINT jako liczby JS (wartości w tym projekcie są małe).
pg.types.setTypeParser(1700, (v) => Number(v));
// DATE jako napis „RRRR-MM-DD” — lokalny dzień użytkownika nie może się przesunąć przez strefę serwera.
pg.types.setTypeParser(1082, (v) => v);

// Na Vercelu wiele krótko żyjących instancji — mała pula (DB_POOL_MAX) i pooler bazy (Neon -pooler).
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: env.DB_POOL_MAX });

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
  visible: Generated<boolean>;
  learned_score: number | null;
  learned_items: number | null;
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

interface TopicTable {
  key: string;
  label: string;
  path: string[];
  node_key: string | null;
  model: string | null;
  embedding: string | null;
  last_feeds_at: NullableTimestamp;
  last_search_at: NullableTimestamp;
  created_at: Timestamp;
}

export type ContentStatus = 'discovered' | 'extracted' | 'partial' | 'blocked' | 'failed' | 'irrelevant';

interface ContentItemTable {
  id: Generated<string>;
  kind: Generated<'article' | 'news' | 'event' | 'club' | 'place'>;
  canonical_url: string;
  url: string;
  source_domain: string;
  source_name: string | null;
  title: string;
  description: string | null;
  language: string | null;
  published_at: NullableTimestamp;
  author: string | null;
  image_url: string | null;
  discovered_via: 'feed' | 'search' | 'organizer' | 'osm';
  feed_url: string | null;
  status: Generated<ContentStatus>;
  status_note: string | null;
  word_count: number | null;
  content_hash: string | null;
  fetched_at: NullableTimestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

interface ContentTextTable {
  content_id: string;
  text: string;
  expires_at: Timestamp;
}

interface ContentEmbeddingTable {
  content_id: string;
  model: string;
  dim: number;
  source_hash: string;
  embedding: string;
  created_at: Timestamp;
}

interface ContentTopicTable {
  content_id: string;
  topic_key: string;
  via: 'feed' | 'search' | 'organizer' | 'osm';
  relevance: number | null;
  discovered_at: Timestamp;
}

interface ProviderUsageTable {
  day: string;
  provider: string;
  calls: Generated<number>;
}

interface SummaryTable {
  id: Generated<string>;
  content_id: string;
  source_hash: string;
  prompt_version: string;
  model: string;
  language: Generated<string>;
  sufficient: boolean;
  card_description: string | null;
  summary: string | null;
  key_facts: JSONColumnType<string[], string, string>;
  caveats: JSONColumnType<string[], string, string>;
  tags: Generated<string[]>;
  basis: 'full' | 'excerpt';
  input_tokens: Generated<number>;
  output_tokens: Generated<number>;
  created_at: Timestamp;
}

interface UserContentStateTable {
  user_id: string;
  content_id: string;
  liked_at: NullableTimestamp;
  read_at: NullableTimestamp;
  skipped_at: NullableTimestamp;
  updated_at: Timestamp;
}

export type InteractionType =
  | 'exposure'
  | 'like'
  | 'unlike'
  | 'summary_open'
  | 'source_click'
  | 'skip'
  | 'unskip'
  | 'read'
  | 'unread'
  | 'less_topic';

interface InteractionTable {
  id: Generated<string>;
  user_id: string;
  content_id: string | null;
  type: InteractionType;
  idempotency_key: string | null;
  created_at: Timestamp;
}

interface DailyAssignmentTable {
  user_id: string;
  local_day: string;
  slot: number;
  content_id: string;
  kind: 'matched' | 'explore';
  score: number;
  reason: JSONColumnType<{ interest: string | null; nodeKey?: string | null; learned?: boolean; margin: number; parts: Record<string, number> }, string, string>;
  profile_version: number;
  created_at: Timestamp;
}

export type EventMethod = 'json-ld' | 'ical' | 'llm-quotes';

interface EventDetailsTable {
  content_id: string;
  starts_at: NullableTimestamp;
  ends_at: NullableTimestamp;
  all_day: Generated<boolean>;
  timezone: Generated<string>;
  rrule: string | null;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  city_normalized: string | null;
  online: Generated<boolean>;
  price_min: number | null;
  price_max: number | null;
  currency: string | null;
  free: Generated<boolean>;
  registration_url: string | null;
  registration_ends_at: NullableTimestamp;
  availability: string | null;
  status: string | null;
  organizer: string | null;
  method: EventMethod;
  quotes: JSONColumnType<Record<string, string>, string, string>;
  source_page: string;
  verified_at: Timestamp;
}

interface PlaceDetailsTable {
  content_id: string;
  osm_ref: string;
  category: string;
  osm_filter: string;
  node_key: string | null;
  lat: number;
  lon: number;
  address: string | null;
  website: string | null;
  opening_hours: string | null;
  city_normalized: string;
  price_min: number | null;
  price_max: number | null;
  free: Generated<boolean>;
  verified_at: Timestamp;
}

interface EventSourceTable {
  url: string;
  city_normalized: string;
  kind: 'ics' | 'page';
  last_fetched_at: NullableTimestamp;
  content_hash: string | null;
  last_status: string | null;
  events_found: number | null;
  updated_at: Timestamp;
}

interface TrendingSnapshotTable {
  id: Generated<string>;
  kind: 'news' | 'events';
  method: string;
  items_considered: number;
  created_at: Timestamp;
}

export interface TrendingMember {
  contentId: string;
  url: string;
  source: string;
  group: string;
  publishedAt: string | null;
}

interface TrendingItemTable {
  snapshot_id: string;
  rank: number;
  content_id: string;
  label: 'multi' | 'radar';
  independent_sources: number;
  members: JSONColumnType<TrendingMember[], string, string>;
  signals: JSONColumnType<Record<string, number>, string, string>;
}

interface WeeklyReportTable {
  id: Generated<string>;
  user_id: string;
  period_key: string;
  period_start: Timestamp;
  period_end: Timestamp;
  scheduled_for: Timestamp;
  status: 'ready' | 'empty';
  subject: string;
  content: JSONColumnType<import('@readyou/shared').ReportContent, string, string>;
  html: string;
  text: string;
  synthesis_model: string | null;
  generated_at: Timestamp;
}

export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'skipped';

interface EmailDeliveryTable {
  id: Generated<string>;
  report_id: string;
  user_id: string;
  channel: Generated<'email'>;
  status: Generated<DeliveryStatus>;
  idempotency_key: string;
  provider: string | null;
  provider_message_id: string | null;
  attempts: Generated<number>;
  last_error: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  sent_at: NullableTimestamp;
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
  topic: TopicTable;
  content_item: ContentItemTable;
  content_text: ContentTextTable;
  content_embedding: ContentEmbeddingTable;
  content_topic: ContentTopicTable;
  provider_usage: ProviderUsageTable;
  summary: SummaryTable;
  user_content_state: UserContentStateTable;
  interaction: InteractionTable;
  daily_assignment: DailyAssignmentTable;
  event_details: EventDetailsTable;
  place_details: PlaceDetailsTable;
  event_source: EventSourceTable;
  trending_snapshot: TrendingSnapshotTable;
  trending_item: TrendingItemTable;
  weekly_report: WeeklyReportTable;
  email_delivery: EmailDeliveryTable;
}

/** Literał pgvector → wektor JS. */
export const fromPgVector = (v: string): number[] => JSON.parse(v) as number[];

/** Wektor JS → literał pgvector. */
export const toPgVector = (v: readonly number[]) => `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;

export const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
