import { z } from 'zod';
import type { Hlc } from '../hlc';
import type { Ulid } from '../id';
import type { EntityDef } from './define';
import { hlc, hlcMap, instant, plainMap, typeName, ulid } from './primitives';
import { ENTITIES, type EntityData, type EntityType } from './registry';

// The plaintext inside an `.lmr` file (SYNC.md §3, DATA-MODEL.md §1).

/**
 * The envelope as stored. It is loose: top-level keys added by a newer client
 * are carried along rather than dropped, because a record is re-encrypted and
 * pushed as a whole.
 */
export const envelopeSchema = z.looseObject({
  id: ulid,
  type: typeName,
  schema: z.int().min(1),
  hlc,
  fieldHlc: hlcMap,
  deletedAt: instant.nullable(),
  createdAt: instant,
  data: plainMap,
});

export type RawEnvelope = z.output<typeof envelopeSchema>;

/** A decoded record of a known type at its current schema version. */
export type EntityRecord<T extends EntityType = EntityType> = {
  [K in T]: {
    id: Ulid;
    type: K;
    schema: number;
    hlc: Hlc;
    fieldHlc: Record<string, Hlc>;
    deletedAt: string | null;
    createdAt: string;
    data: EntityData<K>;
    [extra: string]: unknown;
  };
}[T];

/** Why a record was kept as-is instead of decoded. It is never deleted for any of these. */
export type KeptReason =
  'malformedEnvelope' | 'unknownType' | 'futureSchema' | 'upgradeFailed' | 'invalidData';

export type DecodeResult =
  | { status: 'ok'; record: EntityRecord; upgradedFrom: number | null }
  | { status: 'kept'; reason: KeptReason; raw: unknown; issues: string[] };

const kept = (reason: KeptReason, raw: unknown, issues: string[]): DecodeResult => ({
  status: 'kept',
  reason,
  raw,
  issues,
});

const formatIssues = (error: z.ZodError) =>
  error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);

/**
 * Moves keys the schema doesn't define into `_unknown`, so validation never
 * strips them (DATA-MODEL.md §1).
 */
export function stashUnknownFields(
  def: Pick<EntityDef, 'shape'>,
  data: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  // Object.fromEntries rather than assignment: a stored key such as
  // `__proto__` must stay an ordinary key, not set the object's prototype.
  const entries = Object.entries(data).filter(([key]) => key !== '_unknown');
  const known: Record<string, unknown> = Object.fromEntries(
    entries.filter(([key]) => Object.hasOwn(def.shape, key)),
  );
  const unknown = Object.fromEntries(entries.filter(([key]) => !Object.hasOwn(def.shape, key)));
  const previous = data['_unknown'];
  const isMap = previous !== null && typeof previous === 'object' && !Array.isArray(previous);
  if (previous !== undefined && !isMap) {
    // Leave a malformed `_unknown` in place: validation then fails and the
    // caller keeps the whole raw record.
    known['_unknown'] = previous;
  } else if (previous !== undefined || Object.keys(unknown).length > 0) {
    known['_unknown'] = { ...(previous as Record<string, unknown> | undefined), ...unknown };
  }
  return known;
}

/**
 * Validates a decrypted record and upgrades it to the current schema.
 *
 * This never throws and never discards anything. A record it can't decode is
 * returned as `kept` with the reason, and the caller stores it untouched and
 * keeps syncing it (AGENTS.md §4.3).
 */
export function decodeRecord(
  raw: unknown,
  entities: Readonly<Record<string, EntityDef>> = ENTITIES,
): DecodeResult {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) return kept('malformedEnvelope', raw, formatIssues(envelope.error));
  const env = envelope.data;

  const def = Object.hasOwn(entities, env.type) ? entities[env.type] : undefined;
  if (!def) return kept('unknownType', raw, [`Unknown type "${env.type}"`]);
  if (env.schema > def.version) {
    return kept('futureSchema', raw, [
      `Schema ${String(env.schema)} is newer than ${String(def.version)}`,
    ]);
  }

  let data: Record<string, unknown> = env.data;
  let fieldHlc: Record<string, Hlc> = env.fieldHlc;
  for (let from = env.schema; from < def.version; from++) {
    const upgrade = def.upgraders[from - 1];
    if (!upgrade) return kept('upgradeFailed', raw, [`No upgrader from schema ${String(from)}`]);
    try {
      ({ data, fieldHlc } = upgrade({ data, fieldHlc }));
    } catch (error) {
      return kept('upgradeFailed', raw, [
        `Upgrader from schema ${String(from)} failed: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
  }

  const parsed = def.data.safeParse(stashUnknownFields(def, data));
  if (!parsed.success) return kept('invalidData', raw, formatIssues(parsed.error));

  // Spread the raw object, not zod's copy, so extra envelope keys survive
  // exactly as stored (zod's loose objects drop a `__proto__` key).
  const record = {
    ...(raw as RawEnvelope),
    schema: def.version,
    fieldHlc,
    data: parsed.data,
  } as EntityRecord;
  return { status: 'ok', record, upgradedFrom: env.schema < def.version ? env.schema : null };
}

/**
 * Validates `data` for a local write. Unlike `decodeRecord` this throws: a
 * local write with invalid data is a bug in the caller.
 */
export function parseEntityData<T extends EntityType>(type: T, data: unknown): EntityData<T> {
  const def: EntityDef = ENTITIES[type];
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError(`${type}: data must be an object`);
  }
  return def.data.parse(stashUnknownFields(def, data as Record<string, unknown>)) as EntityData<T>;
}
