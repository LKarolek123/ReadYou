/**
 * Kanały RSS/Atom: darmowe, publikowane przez wydawców właśnie do automatycznego odczytu.
 * Zwracamy tylko pozycje z poprawnym adresem http(s).
 */
import { XMLParser } from 'fast-xml-parser';
import type { SafeFetcher } from './safe-fetch.ts';

export interface FeedItem {
  url: string;
  title: string;
  summary: string | null;
  publishedAt: Date | null;
  imageUrl: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  cdataPropName: false as never,
  processEntities: true,
  htmlEntities: true,
});

const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as object)) return String((v as Record<string, unknown>)['#text']);
  return '';
};
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bdquo: '„' };

/** Encje HTML w treści CDATA (kanały często wstawiają tam zakodowany HTML). */
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });

export const stripHtml = (s: string) =>
  decodeEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
const date = (s: string) => {
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const httpUrl = (s: string | undefined) => {
  if (!s) return null;
  try {
    const u = new URL(s.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
};

export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const out: FeedItem[] = [];
  for (const item of arr(doc.rss?.channel?.item ?? doc['rdf:RDF']?.item)) {
    const url = httpUrl(text(item.link) || item.guid?.['#text']);
    const title = stripHtml(text(item.title));
    if (!url || !title) continue;
    const media = arr(item['media:content'] ?? item['media:thumbnail'])[0] ?? item.enclosure;
    const img = media?.['@url'] && (!media['@type'] || String(media['@type']).startsWith('image')) ? media['@url'] : null;
    out.push({
      url,
      title,
      summary: stripHtml(text(item.description ?? item['content:encoded'])).slice(0, 600) || null,
      publishedAt: date(text(item.pubDate ?? item['dc:date'])),
      imageUrl: httpUrl(img ?? undefined),
    });
  }
  for (const entry of arr(doc.feed?.entry)) {
    const links = arr(entry.link);
    const alt = links.find((l: any) => !l['@rel'] || l['@rel'] === 'alternate') ?? links[0];
    const url = httpUrl(alt?.['@href']);
    const title = stripHtml(text(entry.title));
    if (!url || !title) continue;
    out.push({
      url,
      title,
      summary: stripHtml(text(entry.summary ?? entry.content)).slice(0, 600) || null,
      publishedAt: date(text(entry.published ?? entry.updated)),
      imageUrl: null,
    });
  }
  return out;
}

export async function fetchFeed(fetcher: SafeFetcher, url: string): Promise<FeedItem[]> {
  const res = await fetcher.fetch(url, ['application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml', 'application/rdf+xml', 'text/html']);
  if (res.status >= 400) throw new Error(`Kanał ${url}: HTTP ${res.status}`);
  return parseFeed(res.body.toString('utf8'));
}
