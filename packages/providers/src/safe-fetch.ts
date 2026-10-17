// Port z Pulse & Go: apps/api/app/adapters/outbound/page_fetcher.py, http_identity.py
/**
 * Bezpieczne pobieranie stron zewnętrznych.
 *
 * Ochrona przed SSRF:
 * - tylko http/https, porty 80/443, bez danych logowania w adresie;
 * - każdy adres IP, z którym łączy się klient, jest sprawdzany w momencie połączenia
 *   (hook `lookup` w undici), więc DNS rebinding nie ominie blokady;
 * - blokowane są adresy prywatne, lokalne, link-local (w tym 169.254.169.254 — metadane chmur),
 *   zarezerwowane i multicast, IPv4 i IPv6;
 * - przekierowania obsługujemy ręcznie (maks. 3) i każde sprawdzamy od nowa.
 *
 * Higiena: jawny User-Agent z kontaktem, timeout, limit rozmiaru, odstęp między żądaniami do domeny.
 */
import dns from 'node:dns';
import ipaddr from 'ipaddr.js';
import { Agent, fetch, type Dispatcher } from 'undici';
import { FetchRejectedError } from './errors.ts';

export interface SafeFetchOptions {
  userAgent: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Minimalny odstęp między żądaniami do tej samej domeny. */
  perHostDelayMs?: number;
  /** Tylko w testach: pozwala łączyć się z lokalnym serwerem testowym. */
  allowPrivateForTests?: boolean;
}

export interface FetchedResource {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  headers: Record<string, string>;
  body: Buffer;
}

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let ip = ipaddr.parse(address);
  if (ip.kind() === 'ipv6' && (ip as ipaddr.IPv6).isIPv4MappedAddress()) ip = (ip as ipaddr.IPv6).toIPv4Address();
  return ip.range() === 'unicast';
}

export function assertAllowedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchRejectedError('protocol', 'Niepoprawny adres URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FetchRejectedError('protocol', 'Dozwolone tylko http i https');
  if (url.username || url.password) throw new FetchRejectedError('ssrf', 'Adres z danymi logowania jest niedozwolony');
  if (url.port && url.port !== '80' && url.port !== '443') throw new FetchRejectedError('ssrf', 'Niestandardowy port jest niedozwolony');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(host) && !isPublicAddress(host)) throw new FetchRejectedError('ssrf', 'Adres prywatny lub lokalny jest niedozwolony');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new FetchRejectedError('ssrf', 'Host lokalny jest niedozwolony');
  }
  return url;
}

/** `lookup` dla undici: rozwiązuje nazwę i odrzuca połączenie z adresem niepublicznym. */
export function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = addresses as dns.LookupAddress[];
      const bad = list.find((a) => !allowPrivate && !isPublicAddress(a.address));
      if (bad || !list.length) {
        return callback(new FetchRejectedError('ssrf', `Host ${hostname} wskazuje na adres niepubliczny`));
      }
      if (options.all) return callback(null, list);
      callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

export class SafeFetcher {
  private readonly dispatcher: Dispatcher;
  private readonly lastByHost = new Map<string, number>();
  private readonly hostChains = new Map<string, Promise<unknown>>();

  constructor(private readonly opts: SafeFetchOptions) {
    this.dispatcher = new Agent({
      connect: { lookup: guardedLookup(Boolean(opts.allowPrivateForTests)) as never, timeout: 10_000 },
      headersTimeout: opts.timeoutMs ?? 15_000,
      bodyTimeout: opts.timeoutMs ?? 15_000,
    });
  }

  /** Pobiera zasób; `accept` ogranicza dozwolone typy treści. */
  async fetch(raw: string, accept: readonly string[] = ['text/html', 'application/xhtml+xml']): Promise<FetchedResource> {
    let current = this.opts.allowPrivateForTests ? new URL(raw) : assertAllowedUrl(raw);
    const max = this.opts.maxRedirects ?? 3;
    for (let hop = 0; hop <= max; hop++) {
      const res = await this.serialized(current.hostname, () =>
        fetch(current, {
          dispatcher: this.dispatcher,
          redirect: 'manual',
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
          headers: { 'user-agent': this.opts.userAgent, accept: `${accept.join(', ')};q=1, */*;q=0.1` },
        }),
      );
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel();
        const next = new URL(res.headers.get('location')!, current);
        current = this.opts.allowPrivateForTests ? next : assertAllowedUrl(next.toString());
        continue;
      }
      const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (res.ok && contentType && !accept.includes(contentType)) {
        await res.body?.cancel();
        throw new FetchRejectedError('content_type', `Nieobsługiwany typ treści: ${contentType}`);
      }
      const body = await this.readLimited(res);
      return {
        url: raw,
        finalUrl: current.toString(),
        status: res.status,
        contentType,
        headers: Object.fromEntries(res.headers.entries()),
        body,
      };
    }
    throw new FetchRejectedError('redirects', 'Za dużo przekierowań');
  }

  private async readLimited(res: Awaited<ReturnType<typeof fetch>>): Promise<Buffer> {
    const limit = this.opts.maxBytes ?? 3 * 1024 * 1024;
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > limit) {
      await res.body?.cancel();
      throw new FetchRejectedError('too_large', 'Strona jest zbyt duża');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    if (!res.body) return Buffer.alloc(0);
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > limit) {
        throw new FetchRejectedError('too_large', 'Strona jest zbyt duża');
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /** Jedno żądanie naraz na host, z minimalnym odstępem (grzeczność wobec wydawców). */
  private serialized<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.hostChains.get(host) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(async () => {
      const wait = (this.lastByHost.get(host) ?? 0) + (this.opts.perHostDelayMs ?? 1000) - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastByHost.set(host, Date.now());
      return fn();
    });
    this.hostChains.set(host, run);
    return run;
  }

  async close() {
    await this.dispatcher.close();
  }
}
