import { z } from 'zod';
import { defineEntity } from '../define';
import {
  blobRef,
  instant,
  localDate,
  localTime,
  colorKey,
  orderKey,
  priority,
  recurrence,
  reminder,
  ulid,
} from '../primitives';

// DATA-MODEL.md §4.

export const inboxItem = defineEntity({
  text: z.string(),
  audioBlob: blobRef.exactOptional(),
  transcript: z.string().exactOptional(),
  transcriptStatus: z.enum(['none', 'pending', 'done', 'failed']),
  source: z.enum(['quick', 'share', 'voice', 'import']),
  processedAt: instant.exactOptional(),
});

export const project = defineEntity(
  {
    name: z.string(),
    areaId: ulid.exactOptional(),
    status: z.enum(['active', 'onHold', 'done', 'archived']),
    notes: z.string(),
    color: colorKey.exactOptional(),
    order: orderKey,
  },
  { merge: { notes: 'text' } },
);

export const task = defineEntity(
  {
    title: z.string(),
    notes: z.string(),
    projectId: ulid.exactOptional(),
    parentId: ulid.exactOptional(),
    areaId: ulid.exactOptional(),
    goalId: ulid.exactOptional(),
    milestoneId: ulid.exactOptional(),
    priority,
    status: z.enum(['todo', 'doing', 'done', 'cancelled']),
    dueDate: localDate.exactOptional(),
    dueTime: localTime.exactOptional(),
    scheduledAt: instant.exactOptional(),
    estimateMin: z.int().min(1).exactOptional(),
    recurrence: recurrence.exactOptional(),
    // The task this instance was generated from when a recurring task was completed.
    recurrenceOf: ulid.exactOptional(),
    reminders: z.array(reminder),
    tags: z.array(ulid),
    completedAt: instant.exactOptional(),
    order: orderKey,
  },
  {
    merge: { notes: 'text', tags: 'set' },
    check: {
      fn: (t) => t.dueTime === undefined || t.dueDate !== undefined,
      message: 'dueTime needs a dueDate',
    },
  },
);

export const goal = defineEntity(
  {
    title: z.string(),
    why: z.string(),
    areaId: ulid.exactOptional(),
    targetDate: localDate.exactOptional(),
    status: z.enum(['active', 'onHold', 'done', 'dropped']),
    progressMode: z.enum(['milestones', 'tasks', 'manual']),
    // Percent, 0–100. Only used in `manual` mode.
    manualProgress: z.int().min(0).max(100).exactOptional(),
  },
  { merge: { why: 'text' } },
);

export const milestone = defineEntity({
  goalId: ulid,
  title: z.string(),
  dueDate: localDate.exactOptional(),
  doneAt: instant.exactOptional(),
  order: orderKey,
});
