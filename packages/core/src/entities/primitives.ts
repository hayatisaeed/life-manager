import { z } from 'zod';
import { isHlc } from '../hlc';
import { isUlid } from '../id';

// Shared value types from docs/DATA-MODEL.md §1–2. Every format here has
// exactly one spelling, so equal values are equal strings. The merge relies on
// that, and so does anything that hashes or compares records.

export const ulid = z.string().refine(isUlid, 'Expected a canonical ULID');

export const hlc = z.string().refine(isHlc, 'Expected an HLC');

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLocalDate(value: string): boolean {
  const m = LOCAL_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Round-trip through UTC to reject Feb 30 and friends. This only validates
  // a stored value; it never reads the current time.
  const date = new Date(Date.UTC(y, mo - 1, d));
  date.setUTCFullYear(y); // Date.UTC maps years 0–99 to 1900–1999.
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** A calendar day, `YYYY-MM-DD`, always in the proleptic Gregorian calendar. */
export const localDate = z.string().refine(isLocalDate, 'Expected a YYYY-MM-DD date');

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A moment in time in `Date#toISOString` form: UTC with milliseconds. */
export const instant = z.string().refine((value) => {
  if (!INSTANT.test(value)) return false;
  const ms = Date.parse(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString() === value;
}, 'Expected a UTC instant like 2026-10-09T10:15:00.000Z');

/** A time of day, `HH:mm`, 00:00–23:59. */
export const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');

/** `YYYY-MM`. Budget months are in the user's calendar system, so this is not validated as Gregorian. */
export const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');

/**
 * An IANA zone name such as `Asia/Tehran` or `UTC`. Only the shape is checked:
 * the zone database differs between platforms and grows over time, and a
 * record must not become invalid because one device has an older database.
 */
export const timeZone = z
  .string()
  .regex(/^(?:UTC|[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/, 'Expected an IANA zone');

export const currency = z.string().regex(/^[A-Z]{3}$/, 'Expected an ISO 4217 code');

/** Integer minor units plus a currency. Never a float (AGENTS.md §5). */
export const money = z.strictObject({ amount: z.int(), currency });

/**
 * An attachment, addressed by the hex BLAKE2b-256 of its plaintext. That hash
 * is the blob's associated data and names its file (SYNC.md §1, SECURITY.md §2).
 */
export const blobRef = z.strictObject({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.int().nonnegative(),
  mime: z.string().min(1),
  name: z.string().exactOptional(),
});

/** One of the fixed palette hues in docs/DESIGN.md, by name. Never a raw color. */
export const colorKey = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);

/** A lucide icon name. */
export const iconName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/** An entity type name as it appears in the envelope's `type`. */
export const typeName = z.string().regex(/^[a-z][A-Za-z0-9]{0,63}$/);

/**
 * A reference to any entity. The type is not limited to the types this build
 * knows, so a link to an entity added in a later version stays valid.
 */
export const entityRef = z.strictObject({ type: typeName, id: ulid });

/** 1 is the highest. */
export const priority = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const calendarSystem = z.enum(['gregorian', 'jalali']);

/** 0 = Sunday. */
export const weekday = z.int().min(0).max(6);

/** A fractional-index order key (ADR-012). */
export const orderKey = z.string().min(1);

const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;

const nonZero = (min: number, max: number) =>
  z
    .int()
    .min(min)
    .max(max)
    .refine((n) => n !== 0, 'Must not be 0');

/** A subset of RFC 5545 plus a calendar system (DATA-MODEL.md §2). */
export const recurrence = z
  .strictObject({
    calendar: calendarSystem,
    freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.int().min(1),
    byWeekday: z.array(weekday).min(1).refine(unique, 'Duplicate weekday').exactOptional(),
    // In `calendar`; negative counts from the end, so -1 is the last day.
    byMonthDay: z.array(nonZero(-31, 31)).min(1).refine(unique, 'Duplicate day').exactOptional(),
    byMonth: z
      .array(z.int().min(1).max(12))
      .min(1)
      .refine(unique, 'Duplicate month')
      .exactOptional(),
    bySetPos: z
      .array(nonZero(-366, 366))
      .min(1)
      .refine(unique, 'Duplicate position')
      .exactOptional(),
    until: localDate.exactOptional(),
    count: z.int().min(1).exactOptional(),
    mode: z.enum(['fixed', 'afterCompletion']),
  })
  .refine((r) => r.until === undefined || r.count === undefined, {
    message: 'A recurrence has either `until` or `count`, not both',
  });

/** Relative to the due or start time; negative means before. */
export const reminder = z.strictObject({
  offsetMinutes: z.int(),
  channel: z.literal('notify'),
});

const isPlainMap = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null);

/**
 * An object with arbitrary keys, passed through untouched. `z.record` drops a
 * `__proto__` key; stored data must keep every key it has.
 */
export const plainMap = z.custom<Record<string, unknown>>(isPlainMap, 'Expected an object');

/** Field name → HLC, keeping every key like `plainMap`. */
export const hlcMap = z.custom<Record<string, string>>(
  (value) =>
    isPlainMap(value) && Object.values(value).every((v) => typeof v === 'string' && isHlc(v)),
  'Expected a map of field HLCs',
);

/** Any JSON value, for opaque snapshots and payloads. */
export const json = z.json();
