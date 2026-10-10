import { describe, expect, it } from 'vitest';
import {
  blobRef,
  colorKey,
  currency,
  entityRef,
  instant,
  localDate,
  localTime,
  money,
  recurrence,
  timeZone,
  yearMonth,
} from './primitives';

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('localDate', () => {
  it.each(['2026-10-09', '2024-02-29', '0001-01-01', '0099-12-31', '9999-12-31'])(
    'accepts %s',
    (d) => {
      expect(ok(localDate, d)).toBe(true);
    },
  );
  it.each([
    '2023-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '2026-1-1',
    '26-10-09',
    '2026-10-09T00:00',
  ])('rejects %s', (d) => {
    expect(ok(localDate, d)).toBe(false);
  });
});

describe('instant', () => {
  it('accepts the toISOString form only', () => {
    expect(ok(instant, '2026-10-09T10:15:00.000Z')).toBe(true);
    expect(ok(instant, '2026-10-09T10:15:00Z')).toBe(false);
    expect(ok(instant, '2026-10-09T10:15:00.000+00:00')).toBe(false);
    expect(ok(instant, '2026-02-30T10:15:00.000Z')).toBe(false);
    expect(ok(instant, '2026-10-09T24:00:00.000Z')).toBe(false);
  });
});

describe('small formats', () => {
  it('localTime is HH:mm', () => {
    expect(ok(localTime, '00:00')).toBe(true);
    expect(ok(localTime, '23:59')).toBe(true);
    expect(ok(localTime, '24:00')).toBe(false);
    expect(ok(localTime, '9:00')).toBe(false);
  });
  it('yearMonth allows Jalali months', () => {
    expect(ok(yearMonth, '1405-07')).toBe(true);
    expect(ok(yearMonth, '1405-13')).toBe(false);
  });
  it('timeZone checks the IANA shape only', () => {
    for (const z of ['UTC', 'Asia/Tehran', 'America/Argentina/Buenos_Aires', 'Etc/GMT+3']) {
      expect(ok(timeZone, z)).toBe(true);
    }
    for (const z of ['', 'Tehran', '+03:30', 'Asia/']) expect(ok(timeZone, z)).toBe(false);
  });
  it('money is integer minor units in an ISO currency', () => {
    expect(ok(money, { amount: -1250, currency: 'EUR' })).toBe(true);
    expect(ok(money, { amount: 12.5, currency: 'EUR' })).toBe(false);
    expect(ok(money, { amount: 1, currency: 'eur' })).toBe(false);
    expect(ok(money, { amount: 1, currency: 'EUR', note: 'x' })).toBe(false);
    expect(ok(currency, 'IRR')).toBe(true);
  });
  it('blobRef needs a 64-hex hash', () => {
    expect(ok(blobRef, { hash: 'f'.repeat(64), size: 0, mime: 'a/b' })).toBe(true);
    expect(ok(blobRef, { hash: 'F'.repeat(64), size: 0, mime: 'a/b' })).toBe(false);
  });
  it('colorKey is a palette name, not a raw color', () => {
    expect(ok(colorKey, 'teal')).toBe(true);
    expect(ok(colorKey, '#5B5BD6')).toBe(false);
  });
  it('entityRef allows types this build does not know', () => {
    expect(ok(entityRef, { type: 'futureThing', id: '01J9ZQ4X2K8M3N5P6R7S8T9V0W' })).toBe(true);
    expect(ok(entityRef, { type: 'task', id: 'not-a-ulid' })).toBe(false);
  });
});

describe('recurrence', () => {
  const base = { calendar: 'gregorian', freq: 'weekly', interval: 1, mode: 'fixed' } as const;
  it('accepts RFC 5545-style rules', () => {
    expect(ok(recurrence, { ...base, byWeekday: [2], bySetPos: [2], until: '2027-01-01' })).toBe(
      true,
    );
    expect(ok(recurrence, { ...base, byMonthDay: [-1, 15], byMonth: [1, 7], count: 3 })).toBe(true);
  });
  it('rejects invalid rules', () => {
    expect(ok(recurrence, { ...base, interval: 0 })).toBe(false);
    expect(ok(recurrence, { ...base, byMonthDay: [0] })).toBe(false);
    expect(ok(recurrence, { ...base, byWeekday: [1, 1] })).toBe(false);
    expect(ok(recurrence, { ...base, byWeekday: [] })).toBe(false);
    expect(ok(recurrence, { ...base, byMonth: [13] })).toBe(false);
    expect(ok(recurrence, { ...base, until: '2027-01-01', count: 2 })).toBe(false);
    expect(ok(recurrence, { ...base, freq: 'hourly' })).toBe(false);
  });
});
