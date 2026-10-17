import { CalendarClock, Clock, Globe, MapPin, Ticket, Building2, ShieldCheck } from 'lucide-react';
import type { ArticleCard, EventInfo, PlaceInfo } from '@readyou/shared';

/**
 * Szczegóły wydarzeń i miejsc. Nieznane dane są nazwane wprost („Cena nieznana”, „Godzina nieznana”) —
 * nic nie jest dopowiadane. Daty w strefie wydarzenia.
 */

const fmt = (iso: string, tz: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('pl-PL', { timeZone: tz, ...opts });

function sameLocalDay(a: string, b: string, tz: string) {
  return fmt(a, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }) === fmt(b, tz, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** „sob., 24 paź, 20:00” / „24–26 paź” / „Termin nieznany”. */
export function eventWhen(e: EventInfo): string {
  if (!e.startsAt) return 'Termin nieznany';
  const day = (iso: string) => fmt(iso, e.timezone, { weekday: 'short', day: 'numeric', month: 'short' });
  if (e.allDay) {
    // Koniec całodniowego jest wyłączny (północ następnego dnia) — pokazujemy ostatni dzień.
    if (e.endsAt) {
      const last = new Date(new Date(e.endsAt).getTime() - 1).toISOString();
      if (!sameLocalDay(e.startsAt, last, e.timezone)) return `${day(e.startsAt)} – ${day(last)}`;
    }
    return day(e.startsAt);
  }
  const time = (iso: string) => fmt(iso, e.timezone, { hour: '2-digit', minute: '2-digit' });
  if (e.endsAt && !sameLocalDay(e.startsAt, e.endsAt, e.timezone)) return `${day(e.startsAt)}, ${time(e.startsAt)} – ${day(e.endsAt)}`;
  return `${day(e.startsAt)}, ${time(e.startsAt)}${e.endsAt ? `–${time(e.endsAt)}` : ''}`;
}

export function priceLabel(p: EventInfo['price'] | PlaceInfo['price']): string {
  if (!p) return 'Cena nieznana';
  if (p.free) return 'Wstęp wolny';
  const cur = p.currency === 'PLN' ? 'zł' : p.currency;
  if (p.min !== null && p.max !== null && p.max > p.min) return `${p.min}–${p.max} ${cur}`;
  return `${p.min} ${cur}`;
}

export function placeLabel(e: EventInfo): string {
  if (e.online) return 'Online';
  return e.venue ?? e.address ?? e.city ?? 'Miejsce nieznane';
}

/** Jedna linia metadanych na karcie (zamiast źródła i daty publikacji artykułu). */
export function EventMetaLine({ card }: { card: ArticleCard }) {
  if (card.event) {
    return (
      <div className="flex flex-col gap-0.5 text-[13px] font-medium text-muted">
        <span className="inline-flex items-center gap-1.5 text-ink">
          <CalendarClock className="size-3.5 shrink-0 text-violet" aria-hidden />
          <span className="truncate">{eventWhen(card.event)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          {card.event.online ? <Globe className="size-3.5 shrink-0" aria-hidden /> : <MapPin className="size-3.5 shrink-0" aria-hidden />}
          <span className="truncate">
            {placeLabel(card.event)} · {priceLabel(card.event.price)}
          </span>
        </span>
      </div>
    );
  }
  if (card.place) {
    return (
      <div className="flex flex-col gap-0.5 text-[13px] font-medium text-muted">
        <span className="inline-flex items-center gap-1.5 text-ink">
          <Building2 className="size-3.5 shrink-0 text-violet" aria-hidden />
          <span className="truncate">{card.place.category}</span>
        </span>
        {card.place.address && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{card.place.address}</span>
          </span>
        )}
      </div>
    );
  }
  return null;
}

const Row = ({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) => (
  <div className="flex gap-3 py-2">
    <span className="mt-0.5 text-violet">{icon}</span>
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-[15px] leading-snug">{children}</dd>
    </div>
  </div>
);

const METHOD_LABEL: Record<EventInfo['method'], string> = {
  'json-ld': 'dane strukturalne ze strony organizatora',
  ical: 'kalendarz organizatora (iCal)',
  'llm-quotes': 'odczytane przez AI ze strony organizatora i potwierdzone cytatami',
};

export function EventDetailsBlock({ event, source }: { event: EventInfo; source: string }) {
  const reg = event.registration;
  return (
    <section className="mt-4 rounded-2xl border border-line bg-bg/60 px-4 py-2" aria-label="Szczegóły wydarzenia">
      <dl className="divide-y divide-line/70">
        <Row icon={<CalendarClock className="size-4" />} label="Kiedy">
          {eventWhen(event)}
          {event.startsAt && !event.allDay && !event.endsAt && <span className="block text-sm text-muted">Godzina zakończenia nieznana</span>}
          {event.allDay && event.startsAt && <span className="block text-sm text-muted">Godzina rozpoczęcia nieznana — sprawdź u organizatora</span>}
          {event.recurring && <span className="block text-sm text-muted">Wydarzenie cykliczne</span>}
        </Row>
        <Row icon={event.online ? <Globe className="size-4" /> : <MapPin className="size-4" />} label="Gdzie">
          {placeLabel(event)}
          {!event.online && event.address && event.address !== event.venue && <span className="block text-sm text-muted">{event.address}</span>}
        </Row>
        <Row icon={<Ticket className="size-4" />} label="Cena">
          {priceLabel(event.price)}
          {!event.price && <span className="block text-sm text-muted">Organizator nie podał ceny — to nie znaczy, że wstęp jest wolny.</span>}
        </Row>
        <Row icon={<Clock className="size-4" />} label="Zapisy / bilety">
          {reg.endsAt ? `Do ${new Date(reg.endsAt).toLocaleString('pl-PL', { timeZone: event.timezone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}` : 'Termin zapisów nieznany'}
          {reg.availability && /SoldOut/i.test(reg.availability) && <span className="block text-sm font-semibold text-rose-700">Wyprzedane (wg organizatora)</span>}
        </Row>
      </dl>
      <p className="flex items-start gap-1.5 py-2 text-xs text-muted">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Źródło: {source}, {METHOD_LABEL[event.method]}. Sprawdzone {new Date(event.verifiedAt).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })} — dostępność biletów potwierdź u organizatora.
        </span>
      </p>
    </section>
  );
}

export function PlaceDetailsBlock({ place }: { place: PlaceInfo }) {
  return (
    <section className="mt-4 rounded-2xl border border-line bg-bg/60 px-4 py-2" aria-label="Szczegóły miejsca">
      <dl className="divide-y divide-line/70">
        <Row icon={<Building2 className="size-4" />} label="Rodzaj">
          {place.category}
        </Row>
        <Row icon={<MapPin className="size-4" />} label="Adres">
          {place.address ?? 'Adres nieznany'}
        </Row>
        <Row icon={<Clock className="size-4" />} label="Godziny otwarcia">
          {place.openingHours ?? 'Nieznane — sprawdź na stronie miejsca'}
        </Row>
        {place.price && (
          <Row icon={<Ticket className="size-4" />} label="Cena">
            {priceLabel(place.price)}
          </Row>
        )}
      </dl>
      <p className="py-2 text-xs text-muted">
        Dane:{' '}
        <a href={place.osmUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">
          {place.attribution}
        </a>
        , pobrane {new Date(place.verifiedAt).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}. Stała lokalizacja — bez daty konkretnego wydarzenia.
      </p>
    </section>
  );
}
