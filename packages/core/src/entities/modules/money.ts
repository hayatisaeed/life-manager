import { z } from 'zod';
import { defineEntity } from '../define';
import {
  colorKey,
  currency,
  iconName,
  localDate,
  money,
  recurrence,
  reminder,
  ulid,
  yearMonth,
} from '../primitives';

// DATA-MODEL.md §8. Balances are derived, never stored.

export const account = defineEntity(
  {
    name: z.string(),
    kind: z.enum(['cash', 'bank', 'card', 'savings', 'investment']),
    currency,
    openingBalance: money,
    archived: z.boolean(),
  },
  {
    check: {
      fn: (a) => a.openingBalance.currency === a.currency,
      message: "The opening balance must be in the account's currency",
    },
  },
);

export const category = defineEntity({
  name: z.string(),
  kind: z.enum(['expense', 'income']),
  parentId: ulid.exactOptional(),
  color: colorKey,
  icon: iconName,
});

export const transaction = defineEntity(
  {
    accountId: ulid,
    date: localDate,
    // Negative is an outflow.
    amount: money,
    categoryId: ulid.exactOptional(),
    payee: z.string().exactOptional(),
    notes: z.string(),
    tags: z.array(ulid),
    // Rate to the base currency on `date`. A rate, not an amount, so a float is fine.
    fxToBase: z.number().positive().exactOptional(),
    // Shared by the two legs of a transfer.
    transferId: ulid.exactOptional(),
    billId: ulid.exactOptional(),
  },
  { merge: { notes: 'text', tags: 'set' } },
);

export const budget = defineEntity({
  // In the user's calendar system (DATA-MODEL.md §8).
  month: yearMonth,
  categoryId: ulid,
  // In the base currency.
  limit: money,
  alertAtPct: z.int().min(0).max(100),
});

export const bill = defineEntity({
  name: z.string(),
  amount: money,
  recurrence,
  nextDue: localDate,
  accountId: ulid.exactOptional(),
  categoryId: ulid.exactOptional(),
  autopay: z.boolean(),
  kind: z.enum(['bill', 'subscription']),
  url: z.url().exactOptional(),
  reminders: z.array(reminder),
});

export const savingsGoal = defineEntity({
  name: z.string(),
  target: money,
  accountId: ulid.exactOptional(),
  targetDate: localDate.exactOptional(),
  manualSaved: money.exactOptional(),
});

export const fxRate = defineEntity({
  date: localDate,
  from: currency,
  to: currency,
  rate: z.number().positive(),
  source: z.enum(['manual', 'fetched']),
});
