import { z } from 'zod';
import { CalendarDate } from '@internationalized/date';
import { parseHlc } from '../clock';
export const idSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
    const date = new CalendarDate(year, month, day);
    return date.toString() === value && year > 0;
  });
export const instantSchema = z.iso.datetime({ precision: 3 });
export const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const hlcSchema = z.string().refine((value) => {
  try {
    parseHlc(value);
    return true;
  } catch {
    return false;
  }
});
export const currencySchema = z.string().regex(/^[A-Z]{3}$/);
export const moneySchema = z.object({
  amount: z.number().int().refine(Number.isSafeInteger),
  currency: currencySchema,
});
export const calendarSchema = z.enum(['gregorian', 'jalali']);
export const recurrenceSchema = z.object({
  calendar: calendarSchema,
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().positive(),
  byWeekday: z.array(z.number().int().min(0).max(6)).min(1).optional(),
  byMonthDay: z
    .array(
      z
        .number()
        .int()
        .min(-31)
        .max(31)
        .refine((v) => v !== 0),
    )
    .min(1)
    .optional(),
  byMonth: z.array(z.number().int().min(1).max(12)).min(1).optional(),
  bySetPos: z
    .array(
      z
        .number()
        .int()
        .min(-366)
        .max(366)
        .refine((v) => v !== 0),
    )
    .min(1)
    .optional(),
  until: localDateSchema.optional(),
  count: z.number().int().positive().optional(),
  mode: z.enum(['fixed', 'afterCompletion']),
});
export type Recurrence = z.infer<typeof recurrenceSchema>;
export const reminderSchema = z.object({
  offsetMinutes: z.number().int(),
  channel: z.literal('notify'),
});
/** Blob refs contain a content hash, original name, MIME type and plaintext size. */
export const blobRefSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
});
export const habitScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily') }),
  z.object({ kind: z.literal('weekdays'), days: z.array(z.number().int().min(0).max(6)).min(1) }),
  z.object({
    kind: z.literal('timesPer'),
    times: z.number().int().positive(),
    period: z.enum(['week', 'month']),
  }),
  z.object({ kind: z.literal('everyNDays'), n: z.number().int().positive() }),
]);
