/** Dostawca kazał zwolnić (HTTP 429 / Retry-After). Kolejka ponowi zadanie bez zużycia próby. */
export class ProviderRateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number,
  ) {
    super(message);
  }
}

/** Brak konfiguracji dostawcy (np. klucza). W trybie rzeczywistym to błąd, a nie pusty wynik. */
export class ProviderNotConfiguredError extends Error {}

/** Pobranie strony odrzucone przez nasze zasady (SSRF, robots.txt, rozmiar, typ treści). */
export class FetchRejectedError extends Error {
  constructor(
    public readonly reason: 'ssrf' | 'robots' | 'too_large' | 'content_type' | 'redirects' | 'protocol' | 'tdm',
    message: string,
  ) {
    super(message);
  }
}

/** Dostawca chwilowo niedostępny z przyczyn po stronie konta (brak środków, unieważniony klucz). Ponów po dłuższym czasie. */
export class ProviderUnavailableError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number,
  ) {
    super(message);
  }
}
