// The sync envelope wrapping every record (SYNC.md §3, DATA-MODEL.md §1).

import { z } from 'zod';
import type { EntityData, EntityType } from './registry';
import { entityDef } from './registry';
import { upgradeData } from './upgrade';

export const EnvelopeZ = z.object({
  id: z.string().min(1).max(64),
  type: z.string().min(1).max(64),
  schema: z.number().int().min(1),
  hlc: z.string(),
  fieldHlc: z.record(z.string(), z.string()),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  data: z.record(z.string(), z.unknown()),
});

/** An envelope whose `data` has not been validated against its type's schema. */
export type Envelope = z.infer<typeof EnvelopeZ>;

export interface Rec<T extends EntityType = EntityType> extends Omit<Envelope, 'data' | 'type'> {
  type: T;
  data: EntityData<T>;
}

/** The fieldHlc key used for `deletedAt`. */
export const DELETED_KEY = '$deleted';

export type ParseResult =
  | { ok: true; envelope: Envelope }
  | { ok: false; reason: 'invalid' | 'unknownType' | 'newerSchema'; envelope?: Envelope };

/**
 * Validate a decrypted record at the boundary. Unknown types and newer schemas
 * are reported (not dropped) so callers can keep the raw record (SYNC.md §10).
 */
export function parseEnvelope(raw: unknown): ParseResult {
  const env = EnvelopeZ.safeParse(raw);
  if (!env.success) return { ok: false, reason: 'invalid' };
  const e = env.data;
  const d = entityDef(e.type);
  if (!d) return { ok: false, reason: 'unknownType', envelope: e };
  if (e.schema > d.schema) return { ok: false, reason: 'newerSchema', envelope: e };
  const upgraded = e.schema < d.schema ? upgradeData(e.type, e.schema, e.data) : e.data;
  return { ok: true, envelope: { ...e, schema: d.schema, data: upgraded } };
}

/** Strict validation of `data` (used when the UI creates or edits a record). */
export function validateData(type: string, data: unknown): Record<string, unknown> {
  const d = entityDef(type);
  if (!d) throw new Error(`Unknown entity type: ${type}`);
  return d.data.parse(data) as Record<string, unknown>;
}
