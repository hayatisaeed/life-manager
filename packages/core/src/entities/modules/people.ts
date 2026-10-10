import { z } from 'zod';
import { defineEntity } from '../define';
import { blobRef, calendarSystem, instant, ulid } from '../primitives';

// DATA-MODEL.md §12.

const labeled = z.strictObject({ label: z.string(), value: z.string() });

export const person = defineEntity(
  {
    name: z.string(),
    nativeName: z.string().exactOptional(),
    nickname: z.string().exactOptional(),
    pronouns: z.string().exactOptional(),
    photo: blobRef.exactOptional(),
    emails: z.array(labeled),
    phones: z.array(labeled),
    addresses: z.array(labeled),
    socials: z.array(z.strictObject({ kind: z.string(), handle: z.string() })),
    company: z.string().exactOptional(),
    role: z.string().exactOptional(),
    howWeMet: z.string().exactOptional(),
    relationshipKind: z.enum([
      'family',
      'friend',
      'colleague',
      'acquaintance',
      'professional',
      'other',
    ]),
    circle: z.string().exactOptional(),
    tags: z.array(ulid),
    cadenceDays: z.int().min(1).exactOptional(),
    customFields: z.array(z.strictObject({ key: z.string(), value: z.string() })),
    notes: z.string(),
    archived: z.boolean(),
  },
  { merge: { tags: 'set', notes: 'text' } },
);

export const importantDate = defineEntity(
  {
    personId: ulid,
    kind: z.enum(['birthday', 'anniversary', 'other']),
    label: z.string().exactOptional(),
    // Month and day in `calendar`.
    month: z.int().min(1).max(12),
    day: z.int().min(1).max(31),
    year: z.int().exactOptional(),
    calendar: calendarSystem,
    remindDaysBefore: z.array(z.int().nonnegative()),
  },
  { merge: { remindDaysBefore: 'set' } },
);

export const interaction = defineEntity(
  {
    date: instant,
    kind: z.enum(['call', 'meeting', 'message', 'email', 'inPerson', 'other']),
    personIds: z.array(ulid),
    summary: z.string(),
    notes: z.string(),
    sentiment: z.int().min(-2).max(2).exactOptional(),
    followUpTaskIds: z.array(ulid),
  },
  { merge: { personIds: 'set', followUpTaskIds: 'set', notes: 'text' } },
);

export const relationship = defineEntity({
  aId: ulid,
  bId: ulid,
  kind: z.enum([
    'spouse',
    'partner',
    'parent',
    'child',
    'sibling',
    'colleague',
    'introducedBy',
    'custom',
  ]),
  label: z.string().exactOptional(),
});

export const giftIdea = defineEntity({
  personId: ulid,
  idea: z.string(),
  occasion: z.string().exactOptional(),
  url: z.url().exactOptional(),
  given: z.boolean(),
});
