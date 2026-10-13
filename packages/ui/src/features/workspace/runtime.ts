import { createIdGenerator } from '@lm/core';
import type { Envelope } from '@lm/core';
export const generateId = createIdGenerator(
  () => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32,
);
export const text = (record: Envelope, key: string) =>
  typeof record.data[key] === 'string' ? (record.data[key] as string) : '';
export const titleOf = (record: Envelope) =>
  text(record, 'title') ||
  text(record, 'name') ||
  text(record, 'text') ||
  text(record, 'payee') ||
  text(record, 'metric') ||
  text(record, 'date');
