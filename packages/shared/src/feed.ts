/** Kontrakty API kart, streszczeń i stanów (wspólne dla frontu i API). */
import { z } from 'zod';
import type { IllustrationKey } from './taxonomy.ts';

export interface ContentStateView {
  liked: boolean;
  read: boolean;
  skipped: boolean;
  likedAt: string | null;
  readAt: string | null;
}

/** Szczegóły wydarzenia. Nieznane = null — nie zgadujemy daty, ceny ani statusu zapisów. */
export interface EventInfo {
  startsAt: string | null;
  endsAt: string | null;
  /** Wydarzenie całodniowe lub bez podanej godziny (pokazujemy samą datę). */
  allDay: boolean;
  timezone: string;
  venue: string | null;
  address: string | null;
  city: string | null;
  online: boolean;
  /** null = cena nieznana (to nie znaczy „bezpłatne”). */
  price: { min: number | null; max: number | null; currency: string; free: boolean } | null;
  registration: { url: string | null; endsAt: string | null; availability: string | null };
  organizer: string | null;
  /** Skąd dane: JSON-LD organizatora, kalendarz iCal albo ekstrakcja AI potwierdzona cytatami. */
  method: 'json-ld' | 'ical' | 'llm-quotes';
  verifiedAt: string;
  status: string | null;
  recurring: boolean;
}

/** Klub lub miejsce (stała lokalizacja) — bez wymyślonych dat. */
export interface PlaceInfo {
  category: string;
  address: string | null;
  openingHours: string | null;
  website: string | null;
  osmUrl: string;
  verifiedAt: string;
  attribution: string;
  price: { min: number | null; max: number | null; currency: string; free: boolean } | null;
}

export interface ArticleCard {
  id: string;
  kind: 'article' | 'news' | 'event' | 'club' | 'place';
  title: string;
  /** Krótki opis karty: z AI-streszczenia, a do tego czasu lead wydawcy. */
  description: string | null;
  url: string;
  source: string;
  publishedAt: string | null;
  readingMinutes: number | null;
  /** Ilustracja kategorii — nie zdjęcie wydarzenia ani faktu. */
  illustration: IllustrationKey;
  /** Adres obrazu wydawcy — tylko gdy włączono wyświetlanie obrazów źródłowych. */
  imageUrl: string | null;
  summaryStatus: 'ready' | 'pending' | 'unavailable';
  state: ContentStateView;
  /** „Dlaczego dla Ciebie” — tylko w Twojej puli, oddzielone od faktów. */
  why: { kind: 'matched' | 'explore'; interest: string | null; learned?: boolean; reasons?: string[] } | null;
  event?: EventInfo;
  place?: PlaceInfo;
}

export const EVENT_RANGES = ['today', 'week', 'upcoming', 'places', 'saved'] as const;
export type EventRange = (typeof EVENT_RANGES)[number];

export interface EventFeedView {
  range: EventRange;
  city: string | null;
  items: ArticleCard[];
  /** Czy dla miasta są skonfigurowane źródła wydarzeń (inaczej: tylko wyszukiwarka i wydarzenia online). */
  sourcesConfigured: boolean;
  notice: string | null;
  nextCursor: string | null;
}

export interface FeedView {
  day: string;
  status: 'ready' | 'preparing' | 'empty';
  items: ArticleCard[];
  /** Ile pozycji przydzielono dziś (z przeczytanymi i pominiętymi) — limit to 20. */
  assigned: number;
  limit: number;
  notice: string | null;
}

export interface SummaryView {
  contentId: string;
  title: string;
  status: 'ready' | 'pending' | 'unavailable';
  cardDescription: string | null;
  summary: string | null;
  keyFacts: string[];
  caveats: string[];
  /** „full” = pełny tekst źródła, „excerpt” = tylko dostępny fragment. */
  basis: 'full' | 'excerpt' | null;
  model: string | null;
  source: { name: string; url: string; publishedAt: string | null };
  why: ArticleCard['why'];
  state: ContentStateView;
  kind: ArticleCard['kind'];
  event?: EventInfo;
  place?: PlaceInfo;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

export const contentStatePatchSchema = z
  .object({ liked: z.boolean().optional(), read: z.boolean().optional(), skipped: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Podaj co najmniej jeden stan');
export type ContentStatePatch = z.infer<typeof contentStatePatchSchema>;

export const interactionSchema = z
  .object({
    contentId: z.uuid(),
    type: z.enum(['summary_open', 'source_click', 'exposure']),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
export type InteractionInput = z.infer<typeof interactionSchema>;
