import { z } from 'zod';
import type { Hlc } from '../hlc';
import { plainMap } from './primitives';

/**
 * How the merge (SYNC.md §6) treats a field. Fields that aren't listed are
 * scalars: last writer by `fieldHlc` wins.
 * - `text`: long text, merged with diff3.
 * - `set`: an array compared by element value. Concurrent additions and
 *   removals are combined.
 * - `list`: an array of objects with an `id` and an `order` key, merged item by item.
 */
export type MergeKind = 'text' | 'set' | 'list';

/** What an upgrader sees and returns: the parts of a record that depend on the schema. */
export interface UpgradeInput {
  readonly data: Readonly<Record<string, unknown>>;
  readonly fieldHlc: Readonly<Record<string, Hlc>>;
}

/**
 * Upgrades a record by one schema version. It must be pure, and it must not
 * drop fields it doesn't recognize: they go under `data._unknown`
 * (DATA-MODEL.md §1). If it renames a field, it renames the `fieldHlc` key too.
 */
export type Upgrader = (record: UpgradeInput) => {
  data: Record<string, unknown>;
  fieldHlc: Record<string, Hlc>;
};

/**
 * Fields a record had that this schema doesn't define. They are kept, never
 * dropped, so a later upgrader or a newer client can still use them.
 */
const unknownFields = plainMap.exactOptional();

export interface EntityDef<
  S extends z.ZodRawShape = z.ZodRawShape,
  D extends z.ZodType = z.ZodType,
> {
  /** The current schema number. Records with a lower number are upgraded on read. */
  readonly version: number;
  readonly shape: S;
  /** Validates `data` at the current version. Unknown keys must already be under `_unknown`. */
  readonly data: D;
  readonly merge: Readonly<Partial<Record<keyof S & string, MergeKind>>>;
  /** `upgraders[i]` upgrades schema `i + 1` to `i + 2`. */
  readonly upgraders: readonly Upgrader[];
}

interface EntityOptions<S extends z.ZodRawShape, T> {
  merge?: Partial<Record<keyof S & string, MergeKind>>;
  /** Cross-field rules, e.g. that an account's opening balance is in its currency. */
  check?: { fn: (data: T) => boolean; message: string };
  version?: number;
  upgraders?: readonly Upgrader[];
}

export function defineEntity<S extends z.ZodRawShape>(
  shape: S,
  options: EntityOptions<S, z.output<z.ZodObject<S>>> = {},
) {
  const base = z.object({ ...shape, _unknown: unknownFields });
  const { check } = options;
  const data = check
    ? base.refine((d) => check.fn(d as z.output<z.ZodObject<S>>), { message: check.message })
    : base;
  return {
    version: options.version ?? 1,
    shape,
    data,
    merge: options.merge ?? {},
    upgraders: options.upgraders ?? [],
  } satisfies EntityDef;
}
