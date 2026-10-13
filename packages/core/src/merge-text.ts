import { diff3Merge } from 'node-diff3';
export function mergeText(
  base: string,
  ours: string,
  theirs: string,
): { value: string; conflict: boolean } {
  if (ours === theirs) return { value: ours, conflict: false };
  // Canonical orientation makes conflict blocks identical on both devices.
  const [a, b] = ours < theirs ? [ours, theirs] : [theirs, ours];
  const regions = diff3Merge(a.split('\n'), base.split('\n'), b.split('\n'), {
    excludeFalseConflicts: true,
  });
  const lines: string[] = [];
  let conflict = false;
  for (const region of regions) {
    if (region.ok) lines.push(...region.ok);
    if (region.conflict) {
      conflict = true;
      lines.push('```lm-conflict', ...region.conflict.a, '=======', ...region.conflict.b, '```');
    }
  }
  return { value: lines.join('\n'), conflict };
}
