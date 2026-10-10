import { z } from 'zod';
import { defineEntity } from '../define';
import { instant, ulid } from '../primitives';

// DATA-MODEL.md §7.

export const focusSession = defineEntity({
  taskId: ulid.exactOptional(),
  plannedMin: z.int().min(1),
  start: instant,
  end: instant.exactOptional(),
  breaks: z.array(z.strictObject({ start: instant, end: instant })),
  interruptions: z.int().nonnegative(),
  note: z.string().exactOptional(),
});

export const timeEntry = defineEntity(
  {
    taskId: ulid.exactOptional(),
    projectId: ulid.exactOptional(),
    areaId: ulid.exactOptional(),
    start: instant,
    end: instant,
    source: z.enum(['timer', 'manual', 'block', 'focus']),
    note: z.string().exactOptional(),
  },
  { check: { fn: (e) => e.start <= e.end, message: 'end must not be before start' } },
);
