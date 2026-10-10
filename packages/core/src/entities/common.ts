// Shared zod types for entity data (DATA-MODEL.md §1–2).

import { z } from 'zod';
import { isLocalDate } from '../time/calendar';

export const LocalDateZ = z.string().refine(isLocalDate, 'Expected YYYY-MM-DD');
export const LocalTimeZ = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');
export const InstantZ = z.iso.datetime({ offset: false });
export const IdZ = z.string().min(1).max(64);
export const CurrencyZ = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code');
export const OrderZ = z.string().min(1);
export const ColorZ = z.string().max(32);

export const MoneyZ = z.object({
  /** Integer minor units (AGENTS.md §5 "Money"). */
  amount: z.number().int(),
  currency: CurrencyZ,
});
export type Money = z.infer<typeof MoneyZ>;

export const PriorityZ = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type Priority = z.infer<typeof PriorityZ>;

export const CalendarSystemZ = z.enum(['gregorian', 'jalali']);

export const RecurrenceZ = z.object({
  calendar: CalendarSystemZ,
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(1000),
  byWeekday: z.array(z.number().int().min(0).max(6)).optional(),
  byMonthDay: z
    .array(
      z
        .number()
        .int()
        .min(-31)
        .max(31)
        .refine((n) => n !== 0),
    )
    .optional(),
  byMonth: z.array(z.number().int().min(1).max(12)).optional(),
  bySetPos: z
    .array(
      z
        .number()
        .int()
        .min(-366)
        .max(366)
        .refine((n) => n !== 0),
    )
    .optional(),
  until: LocalDateZ.optional(),
  count: z.number().int().min(1).optional(),
  mode: z.enum(['fixed', 'afterCompletion']),
});
export type Recurrence = z.infer<typeof RecurrenceZ>;

export const ReminderZ = z.object({
  offsetMinutes: z.number().int(),
  channel: z.literal('notify'),
});
export type Reminder = z.infer<typeof ReminderZ>;

export const BlobRefZ = z.object({
  /** Hex BLAKE2b-256 of the plaintext. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().min(0),
  mime: z.string().max(200),
  name: z.string().max(500).optional(),
});
export type BlobRef = z.infer<typeof BlobRefZ>;

export const EntityRefZ = z.object({ type: z.string(), id: IdZ });
export type EntityRef = z.infer<typeof EntityRefZ>;

export const LabeledValueZ = z.object({ label: z.string(), value: z.string() });
