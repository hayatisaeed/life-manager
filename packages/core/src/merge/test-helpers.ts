// Tests build records of made-up and mixed types, so they use a loose record
// shape and cast once at the boundary. Not exported from the package.
import type { EntityDef } from '../entities/define';
import type { EntityRecord as StrictRecord } from '../entities/envelope';
import { mergeRecords as mergeStrict, type MergeResult } from './merge';

export interface LooseRecord {
  id: string;
  type: string;
  schema: number;
  hlc: string;
  fieldHlc: Record<string, string>;
  deletedAt: string | null;
  createdAt: string;
  data: Record<string, unknown>;
  conflicts?: string[];
  [extra: string]: unknown;
}

export type LooseResult = Omit<MergeResult, 'record'> & { record: LooseRecord };

export const mergeLoose = (
  base: LooseRecord | null,
  ours: LooseRecord,
  theirs: LooseRecord,
  entities?: Readonly<Record<string, EntityDef>>,
): LooseResult =>
  mergeStrict(
    base as StrictRecord | null,
    ours as StrictRecord,
    theirs as StrictRecord,
    entities,
  ) as LooseResult;
