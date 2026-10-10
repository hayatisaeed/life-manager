import { z } from 'zod';
import { defineEntity } from '../define';
import {
  colorKey,
  iconName,
  instant,
  json,
  localDate,
  localTime,
  orderKey,
  ulid,
  weekday,
} from '../primitives';

// DATA-MODEL.md §6.

export const habitSchedule = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('daily') }),
  z.strictObject({
    kind: z.literal('weekdays'),
    days: z
      .array(weekday)
      .min(1)
      .refine((d) => new Set(d).size === d.length, 'Duplicate weekday'),
  }),
  z.strictObject({
    kind: z.literal('timesPer'),
    times: z.int().min(1),
    period: z.enum(['week', 'month']),
  }),
  z.strictObject({ kind: z.literal('everyNDays'), n: z.int().min(1) }),
]);

export const habit = defineEntity({
  name: z.string(),
  areaId: ulid.exactOptional(),
  icon: iconName,
  color: colorKey,
  kind: z.enum(['boolean', 'count', 'duration']),
  // A count, or minutes for `duration` habits.
  target: z.number().positive().exactOptional(),
  schedule: habitSchedule,
  reminderTime: localTime.exactOptional(),
  startDate: localDate,
  archived: z.boolean(),
});

export const habitLog = defineEntity({
  habitId: ulid,
  date: localDate,
  // 1 for boolean habits.
  value: z.number().nonnegative(),
  note: z.string().exactOptional(),
});

export const routineStep = z.strictObject({
  id: ulid,
  title: z.string(),
  habitId: ulid.exactOptional(),
  durationMin: z.int().min(1).exactOptional(),
  order: orderKey,
});

export const routine = defineEntity(
  {
    name: z.string(),
    kind: z.enum(['morning', 'evening', 'custom']),
    steps: z.array(routineStep),
    reminderTime: localTime.exactOptional(),
  },
  { merge: { steps: 'list' } },
);

export const routineRun = defineEntity(
  {
    routineId: ulid,
    date: localDate,
    completedStepIds: z.array(ulid),
    startedAt: instant.exactOptional(),
    finishedAt: instant.exactOptional(),
  },
  { merge: { completedStepIds: 'set' } },
);

export const weeklyReview = defineEntity(
  {
    weekStart: localDate,
    done: z.string(),
    slipped: z.string(),
    next: z.string(),
    highlights: z.string().exactOptional(),
    statsSnapshot: json,
  },
  { merge: { done: 'text', slipped: 'text', next: 'text', highlights: 'text' } },
);
