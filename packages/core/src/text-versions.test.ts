import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  appendTextVersion,
  combineTextGraphs,
  renderTextGraph,
  formatHlc,
  mergeRecords,
  editText,
  canonical,
} from './index';
import type { Envelope } from './index';
const clock = (i: number) => formatHlc({ millis: 1000, counter: i, deviceId: 'a' });
const base: Envelope = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  type: 'note',
  schema: 1,
  hlc: clock(0),
  fieldHlc: { content: clock(0) },
  deletedAt: null,
  createdAt: '1970-01-01T00:00:01.000Z',
  data: { content: 'base' },
};
describe('causal text provenance', () => {
  it('renders three concurrent edits identically for all merge groupings', () => {
    const a = editText(base, 'content', 'first', clock(1)),
      b = editText(base, 'content', 'second', clock(2)),
      c = editText(base, 'content', 'third', clock(3));
    const first = mergeRecords(base, mergeRecords(base, a, b), c);
    const second = mergeRecords(base, a, mergeRecords(base, b, c));
    expect(canonical(first)).toBe(canonical(second));
    expect(first.data.content).toContain('first');
    expect(first.data.content).toContain('second');
    expect(first.data.content).toContain('third');
    expect(first.textVersions?.content).toHaveLength(4);
  });
  it('resolving a conflict supersedes all prior heads and remains stable on resync', () => {
    const a = editText(base, 'content', 'first', clock(1)),
      b = editText(base, 'content', 'second', clock(2));
    const merged = mergeRecords(base, a, b);
    const resolved = editText(merged, 'content', 'resolved', clock(3));
    expect(mergeRecords(base, resolved, a).data.content).toBe('resolved');
    expect(mergeRecords(base, resolved, b).data.hasConflict).toBe(false);
    expect(() => editText(base, 'title', 'title', clock(1))).toThrow();
    expect(() => editText(base, 'content', 'bad', clock(0))).toThrow();
  });
  it('rejects missing ancestry, cycles and clock collisions instead of dropping versions', () => {
    expect(() =>
      combineTextGraphs([{ clock: clock(1), value: 'a', parents: [clock(0)] }]),
    ).toThrow();
    expect(() =>
      combineTextGraphs([{ clock: clock(1), value: 'a', parents: [clock(1)] }]),
    ).toThrow();
    expect(() =>
      combineTextGraphs(
        [{ clock: clock(1), value: 'a', parents: [] }],
        [{ clock: clock(1), value: 'b', parents: [] }],
      ),
    ).toThrow();
    expect(renderTextGraph([])).toEqual({ value: '', conflict: false });
  });
  it('converges for five replicas under random delivery orders, including stale resends', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { minLength: 5, maxLength: 5 }),
        fc.shuffledSubarray([0, 1, 2, 3, 4], { minLength: 5, maxLength: 5 }),
        (values, order) => {
          const versions = values.map((value, i) => editText(base, 'content', value, clock(i + 1)));
          const replicas = order.map((offset) => {
            let current = base;
            for (let i = 0; i < order.length; i += 1) {
              const index = order[(i + offset) % order.length] ?? 0;
              const remote = versions[index];
              if (!remote) throw new Error('Invalid simulation index');
              current = mergeRecords(base, current, remote);
            }
            for (const remote of versions) current = mergeRecords(base, current, remote);
            return canonical(current);
          });
          expect(new Set(replicas).size).toBe(1);
        },
      ),
      { numRuns: 1000 },
    );
  }, 30_000);
  it('merges causally later edits over earlier versions while retaining concurrent edits', () => {
    const root = [{ clock: clock(0), value: 'a\nb\nc', parents: [] }];
    const first = appendTextVersion(root, clock(1), 'A\nb\nc');
    const second = appendTextVersion(root, clock(2), 'a\nb\nC');
    expect(renderTextGraph(combineTextGraphs(first, second))).toEqual({
      value: 'A\nb\nC',
      conflict: false,
    });
    const later = appendTextVersion(first, clock(3), 'AA\nb\nc');
    expect(renderTextGraph(combineTextGraphs(later, second))).toEqual({
      value: 'AA\nb\nC',
      conflict: false,
    });
  });
});
