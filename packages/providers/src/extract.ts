// Port z Pulse & Go: apps/api/app/adapters/outbound/compliance_http.py (sygnały TDM), html_text.py
/**
 * ContentExtractor: metadane i tekst artykułu ze strony wydawcy.
 *
 * Źródła metadanych (od najbardziej wiarygodnych): JSON-LD (NewsArticle/Article/BlogPosting),
 * Open Graph / meta artykułu, <title>. Tekst główny: Mozilla Readability.
 *
 * Tekst strony to niezaufane dane: nie wykonujemy niczego, co w nim jest, a przy streszczaniu
 * traktujemy go wyłącznie jako materiał źródłowy.
 */
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { FetchRejectedError } from './errors.ts';
import type { RobotsGuard } from './robots.ts';
import type { SafeFetcher } from './safe-fetch.ts';
import { canonicalizeUrl, sourceDomain } from './url.ts';

export interface ExtractedArticle {
  url: string;
  canonicalUrl: string;
  sourceDomain: string;
  siteName: string | null;
  title: string | null;
  description: string | null;
  language: string | null;
  publishedAt: Date | null;
  modifiedAt: Date | null;
  author: string | null;
  imageUrl: string | null;
  /** Główny tekst (przycięty). Null, gdy strony nie dało się odczytać jako artykułu. */
  text: string | null;
  wordCount: number;
  /** Treść dostępna tylko częściowo (np. paywall lub bardzo krótki tekst). */
  partial: boolean;
  /** Typ z JSON-LD/OG (np. NewsArticle, article, website). */
  pageType: string | null;
  tdmReserved: boolean;
}

const MAX_TEXT_CHARS = 20_000;

export class ContentExtractor {
  constructor(
    private readonly fetcher: SafeFetcher,
    private readonly robots: RobotsGuard,
  ) {}

  async extract(url: string): Promise<ExtractedArticle> {
    await this.robots.assertAllowed(url);
    const res = await this.fetcher.fetch(url);
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    return parseArticle(decode(res.body, res.headers['content-type']), res.finalUrl, res.headers);
  }
}

function decode(body: Buffer, contentType: string | undefined): string {
  const charset = /charset=([\w-]+)/i.exec(contentType ?? '')?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(body.subarray(0, 2048).toString('latin1'))?.[1];
  try {
    return new TextDecoder(charset?.toLowerCase() ?? 'utf-8').decode(body);
  } catch {
    return body.toString('utf8');
  }
}

const clean = (s: unknown): string | null => {
  if (typeof s !== 'string') return null;
  const v = s.replace(/\s+/g, ' ').trim();
  return v || null;
};

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) || d.getFullYear() < 1995 || d.getTime() > Date.now() + 86_400_000 ? null : d;
}

type Json = Record<string, unknown>;

function jsonLdArticles(document: Document): Json[] {
  const out: Json[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    const n = node as Json;
    const types = ([] as unknown[]).concat(n['@type'] ?? []).map(String);
    if (types.some((t) => /(News)?Article|BlogPosting|Report|TechArticle/.test(t))) out.push(n);
    visit(n['@graph']);
  };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(s.textContent ?? ''));
    } catch {
      /* zepsuty JSON-LD na stronie nie przerywa ekstrakcji */
    }
  }
  return out;
}

const pickImage = (v: unknown): string | null => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return pickImage(v[0]);
  if (v && typeof v === 'object') return pickImage((v as Json).url ?? (v as Json).contentUrl);
  return null;
};
const pickName = (v: unknown): string | null => {
  if (typeof v === 'string') return clean(v);
  if (Array.isArray(v)) return pickName(v[0]);
  if (v && typeof v === 'object') return clean((v as Json).name);
  return null;
};

export function tdmReserved(headers: Record<string, string>, document: Document): boolean {
  if ((headers['tdm-reservation'] ?? '').trim() === '1') return true;
  if (/\bnoai\b/i.test(headers['x-robots-tag'] ?? '')) return true;
  const meta = (name: string) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? '';
  return meta('tdm-reservation').trim() === '1' || /\bnoai\b/i.test(meta('robots'));
}

export function parseArticle(html: string, finalUrl: string, headers: Record<string, string> = {}): ExtractedArticle {
  const { document } = parseHTML(html);
  const meta = (key: string) =>
    clean(document.querySelector(`meta[property="${key}"]`)?.getAttribute('content')) ??
    clean(document.querySelector(`meta[name="${key}"]`)?.getAttribute('content'));
  const ld = jsonLdArticles(document)[0] ?? {};

  const canonicalHref = document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? meta('og:url');
  let canonical = canonicalizeUrl(finalUrl);
  if (canonicalHref) {
    try {
      const c = new URL(canonicalHref, finalUrl);
      // Kanoniczny adres akceptujemy tylko w tej samej domenie (strona nie może „przejąć” cudzego adresu).
      if (sourceDomain(c.toString()) === sourceDomain(finalUrl)) canonical = canonicalizeUrl(c.toString());
    } catch {
      /* zły canonical — zostaje adres końcowy */
    }
  }

  const imageRaw = pickImage(ld.image) ?? meta('og:image') ?? meta('twitter:image');
  let imageUrl: string | null = null;
  if (imageRaw) {
    try {
      const u = new URL(imageRaw, finalUrl);
      if (u.protocol === 'https:' || u.protocol === 'http:') imageUrl = u.toString();
    } catch {
      /* pomijamy */
    }
  }

  // Readability modyfikuje DOM, więc działa na osobnej kopii.
  let text: string | null = null;
  let readableTitle: string | null = null;
  try {
    const parsed = new Readability(parseHTML(html).document as unknown as Document, { charThreshold: 300 }).parse();
    text = clean(parsed?.textContent?.replace(/\n{2,}/g, '\n'))?.slice(0, MAX_TEXT_CHARS) ?? null;
    readableTitle = clean(parsed?.title);
  } catch {
    text = null;
  }
  const wordCount = text ? text.split(/\s+/).length : 0;
  const accessibleForFree = String(ld.isAccessibleForFree ?? '').toLowerCase();

  const lang = clean(document.documentElement?.getAttribute('lang')) ?? meta('og:locale') ?? clean(ld.inLanguage);
  return {
    url: finalUrl,
    canonicalUrl: canonical,
    sourceDomain: sourceDomain(canonical),
    siteName: meta('og:site_name') ?? pickName(ld.publisher),
    title: clean(ld.headline) ?? meta('og:title') ?? readableTitle ?? clean(document.querySelector('title')?.textContent),
    description: meta('og:description') ?? meta('description') ?? clean(ld.description),
    language: lang ? lang.slice(0, 2).toLowerCase() : null,
    publishedAt: parseDate(ld.datePublished) ?? parseDate(meta('article:published_time')) ?? parseDate(meta('date')),
    modifiedAt: parseDate(ld.dateModified) ?? parseDate(meta('article:modified_time')),
    author: pickName(ld.author) ?? meta('author'),
    imageUrl,
    text,
    wordCount,
    partial: wordCount < 120 || accessibleForFree === 'false',
    pageType: clean(([] as unknown[]).concat(ld['@type'] ?? [])[0]) ?? meta('og:type'),
    tdmReserved: tdmReserved(headers, document as unknown as Document),
  };
}

export { FetchRejectedError };
