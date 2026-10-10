import { diff3Merge } from 'node-diff3';

// Long-text merge (SYNC.md §6): line-based diff3. Where both sides changed the
// same lines, both versions are kept in a conflict block for the user to
// resolve; nothing is dropped.

export const CONFLICT_START = '<<<<<<< conflict';
export const CONFLICT_SEPARATOR = '=======';
export const CONFLICT_END = '>>>>>>> end';

export interface TextMergeResult {
  text: string;
  conflict: boolean;
}

/**
 * Merges two edits of `base`. `first` and `second` must be given in an order
 * that doesn't depend on which side is local (the caller orders them by HLC),
 * so both devices write the same conflict block.
 */
export function mergeText(base: string, first: string, second: string): TextMergeResult {
  const regions = diff3Merge(first.split('\n'), base.split('\n'), second.split('\n'), {
    excludeFalseConflicts: true,
  });
  let conflict = false;
  const lines: string[] = [];
  for (const region of regions) {
    if (region.conflict) {
      conflict = true;
      lines.push(
        CONFLICT_START,
        ...region.conflict.a,
        CONFLICT_SEPARATOR,
        ...region.conflict.b,
        CONFLICT_END,
      );
    } else {
      lines.push(...(region.ok as string[]));
    }
  }
  return { text: lines.join('\n'), conflict };
}
