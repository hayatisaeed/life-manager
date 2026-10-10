import { z } from 'zod';
import { defineEntity } from '../define';
import { colorKey, entityRef, iconName, orderKey } from '../primitives';

// DATA-MODEL.md §3.

export const area = defineEntity({
  name: z.string(),
  color: colorKey,
  icon: iconName,
  targetWeight: z.int().min(0).max(10),
  order: orderKey,
  archived: z.boolean(),
});

export const tag = defineEntity({
  name: z.string(),
  color: colorKey,
});

export const link = defineEntity({
  from: entityRef,
  to: entityRef,
  kind: z.enum(['related', 'mentions', 'blocks', 'partOf', 'about']),
});
