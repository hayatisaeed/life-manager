import { z } from 'zod';
import { defineEntity } from '../define';
import { blobRef, localDate, orderKey, recurrence, ulid } from '../primitives';

// DATA-MODEL.md §11.

export const document = defineEntity(
  {
    kind: z.enum([
      'id',
      'passport',
      'license',
      'warranty',
      'contract',
      'insurance',
      'medical',
      'other',
    ]),
    title: z.string(),
    number: z.string().exactOptional(),
    issuer: z.string().exactOptional(),
    issueDate: localDate.exactOptional(),
    expiryDate: localDate.exactOptional(),
    files: z.array(blobRef),
    remindDaysBefore: z.array(z.int().nonnegative()),
    personId: ulid.exactOptional(),
    assetId: ulid.exactOptional(),
    notes: z.string(),
  },
  { merge: { files: 'set', remindDaysBefore: 'set', notes: 'text' } },
);

export const shoppingList = defineEntity({
  name: z.string(),
  store: z.string().exactOptional(),
});

export const shoppingItem = defineEntity({
  listId: ulid,
  name: z.string(),
  qty: z.number().positive().exactOptional(),
  unit: z.string().exactOptional(),
  done: z.boolean(),
  order: orderKey,
  category: z.string().exactOptional(),
});

export const asset = defineEntity(
  {
    name: z.string(),
    kind: z.enum(['home', 'appliance', 'vehicle', 'device', 'other']),
    purchaseDate: localDate.exactOptional(),
    warrantyDocId: ulid.exactOptional(),
    notes: z.string(),
  },
  { merge: { notes: 'text' } },
);

export const maintenancePlan = defineEntity(
  {
    assetId: ulid.exactOptional(),
    title: z.string(),
    recurrence,
    lastDone: localDate.exactOptional(),
    nextDue: localDate,
    notes: z.string(),
  },
  { merge: { notes: 'text' } },
);
