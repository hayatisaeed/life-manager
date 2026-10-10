import { z } from 'zod';
import { defineEntity } from '../define';
import { instant, ulid } from '../primitives';

// DATA-MODEL.md §10. Card scheduling uses ts-fsrs; `state` is its `State` enum
// (0 New, 1 Learning, 2 Review, 3 Relearning).

const fsrsState = z.int().min(0).max(3);

export const note = defineEntity(
  {
    title: z.string(),
    content: z.string(),
    tags: z.array(ulid),
    pinned: z.boolean(),
    folder: z.string().exactOptional(),
  },
  { merge: { content: 'text', tags: 'set' } },
);

export const resource = defineEntity(
  {
    kind: z.enum(['book', 'course', 'article', 'video', 'podcast']),
    title: z.string(),
    author: z.string().exactOptional(),
    url: z.url().exactOptional(),
    status: z.enum(['want', 'doing', 'done', 'dropped']),
    progress: z.strictObject({
      current: z.number().nonnegative(),
      total: z.number().nonnegative(),
      unit: z.enum(['pages', 'percent', 'lessons']),
    }),
    rating: z.int().min(1).max(5).exactOptional(),
    startedAt: instant.exactOptional(),
    finishedAt: instant.exactOptional(),
    notes: z.string(),
  },
  { merge: { notes: 'text' } },
);

export const deck = defineEntity({
  name: z.string(),
  description: z.string().exactOptional(),
});

export const card = defineEntity({
  deckId: ulid,
  front: z.string(),
  back: z.string(),
  sourceNoteId: ulid.exactOptional(),
  fsrs: z.strictObject({
    due: instant,
    stability: z.number().nonnegative(),
    difficulty: z.number().nonnegative(),
    elapsedDays: z.int().nonnegative(),
    scheduledDays: z.int().nonnegative(),
    reps: z.int().nonnegative(),
    lapses: z.int().nonnegative(),
    state: fsrsState,
    lastReview: instant.exactOptional(),
  }),
  suspended: z.boolean(),
});

export const reviewLog = defineEntity({
  cardId: ulid,
  rating: z.int().min(1).max(4),
  reviewedAt: instant,
  elapsedDays: z.int().nonnegative(),
  scheduledDays: z.int().nonnegative(),
  state: fsrsState,
});
