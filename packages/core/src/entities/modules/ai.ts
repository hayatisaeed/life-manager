import { z } from 'zod';
import { defineEntity } from '../define';
import { instant, json, localDate, ulid } from '../primitives';
import { timeBlockShape } from './calendar';

// DATA-MODEL.md §13.

export const planProposal = defineEntity(
  {
    range: z.strictObject({ start: instant, end: instant }),
    // `id` is the id the TimeBlock gets if the user accepts this block.
    blocks: z.array(z.strictObject({ id: ulid, ...timeBlockShape })),
    rationale: z.string(),
    provider: z.string(),
    status: z.enum(['pending', 'accepted', 'discarded']),
    acceptedBlockIds: z.array(ulid),
  },
  { merge: { rationale: 'text', acceptedBlockIds: 'set' } },
);

export const insight = defineEntity(
  {
    period: z.strictObject({ start: localDate, end: localDate }),
    kind: z.enum(['weekly', 'correlation', 'wheel']),
    payload: json,
    narrative: z.string().exactOptional(),
  },
  { merge: { narrative: 'text' } },
);
