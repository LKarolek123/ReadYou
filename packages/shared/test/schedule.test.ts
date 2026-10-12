import { describe, expect, it } from 'vitest';
import { nextReportAt, normalizeTag } from '../src/index.ts';

const WAW = 'Europe/Warsaw';

describe('termin raportu: piątek 20:00 Europe/Warsaw', () => {
  it('latem (CEST, UTC+2) to 18:00 UTC', () => {
    const at = nextReportAt(new Date('2026-10-12T10:00:00Z'), WAW, 5, '20:00'); // poniedziałek
    expect(at.toISOString()).toBe('2026-10-16T18:00:00.000Z');
  });

  it('po zmianie czasu (CET, UTC+1) to 19:00 UTC', () => {
    // 25.10.2026 zmiana czasu; następny piątek 30.10
    const at = nextReportAt(new Date('2026-10-24T12:00:00Z'), WAW, 5, '20:00');
    expect(at.toISOString()).toBe('2026-10-30T19:00:00.000Z');
  });

  it('wiosenna zmiana czasu (29.03.2026) — piątek 3.04 o 18:00 UTC', () => {
    const at = nextReportAt(new Date('2026-03-28T12:00:00Z'), WAW, 5, '20:00');
    expect(at.toISOString()).toBe('2026-04-03T18:00:00.000Z');
  });

  it('w piątek po 20:00 wybiera kolejny tydzień, przed 20:00 — ten sam dzień', () => {
    const before = nextReportAt(new Date('2026-10-16T17:59:00Z'), WAW, 5, '20:00');
    expect(before.toISOString()).toBe('2026-10-16T18:00:00.000Z');
    const after = nextReportAt(new Date('2026-10-16T18:00:00Z'), WAW, 5, '20:00');
    expect(after.toISOString()).toBe('2026-10-23T18:00:00.000Z');
  });

  it('uwzględnia inną strefę użytkownika', () => {
    const at = nextReportAt(new Date('2026-10-12T10:00:00Z'), 'America/New_York', 5, '20:00');
    expect(at.toISOString()).toBe('2026-10-17T00:00:00.000Z');
  });
});

describe('normalizacja tagów', () => {
  it('usuwa diakrytyki, wielkość liter i interpunkcję', () => {
    expect(normalizeTag('  Łódź — Taniec  Towarzyski! ')).toBe('lodz taniec towarzyski');
  });
});
