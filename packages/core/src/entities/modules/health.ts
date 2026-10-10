import { z } from 'zod';
import { defineEntity } from '../define';
import { instant, localDate, ulid } from '../primitives';

// DATA-MODEL.md §9.

const metricKey = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/);

export const healthLog = defineEntity({
  // Sleep is attributed to the date of the night it started.
  date: localDate,
  metric: z.union([
    z.enum(['sleep', 'water', 'exercise', 'mood', 'energy', 'weight']),
    z.string().regex(/^custom:[a-z0-9][a-z0-9_-]{0,31}$/),
  ]),
  value: z.number(),
  unit: z.string(),
  start: instant.exactOptional(),
  end: instant.exactOptional(),
  note: z.string().exactOptional(),
});

export const metricDef = defineEntity({
  key: metricKey,
  name: z.string(),
  unit: z.string(),
  kind: z.enum(['number', 'scale5', 'boolean']),
});

export const journalEntry = defineEntity(
  {
    date: localDate,
    body: z.string(),
    promptId: ulid.exactOptional(),
    mood: z.int().min(1).max(5).exactOptional(),
    tags: z.array(ulid),
  },
  { merge: { body: 'text', tags: 'set' } },
);

export const journalPrompt = defineEntity({
  text: z.string(),
  schedule: z.enum(['daily', 'weekly', 'random']).exactOptional(),
  active: z.boolean(),
});
