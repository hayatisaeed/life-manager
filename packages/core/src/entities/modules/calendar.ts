import { z } from 'zod';
import { defineEntity } from '../define';
import { instant, recurrence, reminder, timeZone, ulid } from '../primitives';

// DATA-MODEL.md §5. External calendar events are a device-local cache, not entities.

const startBeforeEnd = {
  fn: (d: { start: string; end: string }) => d.start <= d.end,
  message: 'end must not be before start',
};

export const event = defineEntity(
  {
    title: z.string(),
    notes: z.string(),
    start: instant,
    end: instant,
    allDay: z.boolean(),
    timeZone,
    location: z.string().exactOptional(),
    recurrence: recurrence.exactOptional(),
    reminders: z.array(reminder),
    source: z.literal('local'),
  },
  { merge: { notes: 'text' }, check: startBeforeEnd },
);

export const timeBlockShape = {
  taskId: ulid.exactOptional(),
  title: z.string(),
  start: instant,
  end: instant,
  kind: z.enum(['task', 'focus', 'routine', 'buffer']),
};

export const timeBlock = defineEntity(
  { ...timeBlockShape, proposalId: ulid.exactOptional() },
  { check: startBeforeEnd },
);
