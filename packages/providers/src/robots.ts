// Port z Pulse & Go: apps/api/app/adapters/outbound/page_fetcher.py (_check_robots)
/**
 * robots.txt z krótkim cache per origin.
 * Brak pliku (4xx) = wolno. Niedostępny plik (5xx, błąd sieci) = nie wiemy, więc nie pobieramy.
 */
import robotsParser from 'robots-parser';
import { FetchRejectedError } from './errors.ts';
import type { SafeFetcher } from './safe-fetch.ts';

const TTL_MS = 15 * 60_000;

type Robots = ReturnType<typeof robotsParser> | null;

export class RobotsGuard {
  private readonly cache = new Map<string, { robots: Robots | 'unavailable'; at: number }>();

  constructor(
    private readonly fetcher: SafeFetcher,
    private readonly userAgentToken: string,
  ) {}

  async assertAllowed(url: string): Promise<void> {
    const origin = new URL(url).origin;
    let entry = this.cache.get(origin);
    if (!entry || Date.now() - entry.at > TTL_MS) {
      entry = { robots: await this.load(origin), at: Date.now() };
      this.cache.set(origin, entry);
    }
    if (entry.robots === 'unavailable') {
      throw new FetchRejectedError('robots', 'robots.txt niedostępny — nie pobieramy');
    }
    if (entry.robots && entry.robots.isAllowed(url, this.userAgentToken) === false) {
      throw new FetchRejectedError('robots', 'Strona zabrania automatycznego pobierania (robots.txt)');
    }
  }

  private async load(origin: string): Promise<Robots | 'unavailable'> {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      const res = await this.fetcher.fetch(robotsUrl, ['text/plain', 'text/html', 'application/octet-stream']);
      if (res.status >= 500) return 'unavailable';
      if (res.status >= 400) return null;
      return robotsParser(robotsUrl, res.body.toString('utf8').slice(0, 512 * 1024));
    } catch (err) {
      if (err instanceof FetchRejectedError && err.reason === 'content_type') return null;
      return 'unavailable';
    }
  }
}
