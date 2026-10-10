import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Envelope } from '../src';
import {
  CONFLICT_START,
  DELETED_KEY,
  deepEqual,
  merge,
  mergeDetailed,
  mergeList,
  mergeSet,
  mergeText,
  stableStringify,
} from '../src';

const H = (n: number, dev: string) =>
  `2026-10-09T10:00:00.${String(n).padStart(3, '0')}Z-0000-${dev}`;

function env(
  data: Record<string, unknown>,
  fieldHlc: Record<string, string>,
  extra: Partial<Envelope> = {},
): Envelope {
  return {
    id: 'R1',
    type: 'task',
    schema: 1,
    hlc: Object.values(fieldHlc).sort().at(-1) ?? H(0, 'a'),
    fieldHlc,
    deletedAt: null,
    createdAt: '2026-10-09T10:00:00.000Z',
    data,
    ...extra,
  };
}

const baseData = { title: 'Call mom', notes: 'line1\nline2\nline3', tags: ['family'], priority: 2 };
const baseHlc = { title: H(1, 'a'), notes: H(1, 'a'), tags: H(1, 'a'), priority: H(1, 'a') };
const BASE = env(baseData, baseHlc);

describe('merge rules', () => {
  it('one-sided change wins', () => {
    const ours = env({ ...baseData, title: 'Call dad' }, { ...baseHlc, title: H(5, 'a') });
    const m = merge(BASE, ours, BASE);
    expect(m.data['title']).toBe('Call dad');
    expect(m.fieldHlc['title']).toBe(H(5, 'a'));
    expect(merge(BASE, BASE, ours).data['title']).toBe('Call dad');
  });
  it('scalar: newer hlc wins, tie → larger value', () => {
    const o = env({ ...baseData, priority: 1 }, { ...baseHlc, priority: H(5, 'a') });
    const t = env({ ...baseData, priority: 3 }, { ...baseHlc, priority: H(6, 'b') });
    expect(merge(BASE, o, t).data['priority']).toBe(3);
    expect(merge(BASE, t, o).data['priority']).toBe(3);
    const t2 = env({ ...baseData, priority: 3 }, { ...baseHlc, priority: H(5, 'a') });
    expect(merge(BASE, o, t2).data['priority']).toBe(3);
  });
  it('sets merge adds and removes', () => {
    const o = env({ ...baseData, tags: ['family', 'urgent'] }, { ...baseHlc, tags: H(5, 'a') });
    const t = env({ ...baseData, tags: ['phone'] }, { ...baseHlc, tags: H(6, 'b') });
    expect(merge(BASE, o, t).data['tags']).toEqual(['phone', 'urgent']);
    expect(mergeSet([], [1, 1], [2])).toEqual([1, 2]);
  });
  it('text: non-overlapping edits combine; overlapping keep both', () => {
    const o = env({ ...baseData, notes: 'LINE1\nline2\nline3' }, { ...baseHlc, notes: H(5, 'a') });
    const t = env({ ...baseData, notes: 'line1\nline2\nLINE3' }, { ...baseHlc, notes: H(6, 'b') });
    expect(merge(BASE, o, t).data['notes']).toBe('LINE1\nline2\nLINE3');
    const t2 = env(
      { ...baseData, notes: 'line1-x\nline2\nline3' },
      { ...baseHlc, notes: H(6, 'b') },
    );
    const r = mergeDetailed(BASE, o, t2);
    expect(r.textConflict).toBe(true);
    expect(r.envelope.data['hasConflict']).toBe(true);
    const notes = r.envelope.data['notes'] as string;
    expect(notes).toContain(CONFLICT_START);
    expect(notes).toContain('LINE1');
    expect(notes).toContain('line1-x');
    expect(merge(BASE, t2, o).data['notes']).toBe(notes);
  });
  it('text tie on hlc orders by value', () => {
    const a = mergeText('x', 'a', 'b', 'h', 'h');
    const b = mergeText('x', 'b', 'a', 'h', 'h');
    expect(a).toEqual(b);
  });
  it('lists merge by item id', () => {
    const base = [
      { id: 's1', title: 'A', order: 'a0' },
      { id: 's2', title: 'B', order: 'a1' },
      { id: 's3', title: 'C', order: 'a2' },
    ];
    const ours = [
      { id: 's1', title: 'A!', order: 'a0' },
      { id: 's3', title: 'C', order: 'a2' },
      { id: 's4', title: 'D', order: 'a3' },
    ];
    const theirs = [
      { id: 's1', title: 'A', order: 'a0' },
      { id: 's2', title: 'B', order: 'a1' },
      { id: 's3', title: 'C?', order: 'Zz' },
    ];
    expect(mergeList(base, ours, theirs, 'h1', 'h2')).toEqual([
      { id: 's3', title: 'C?', order: 'Zz' },
      { id: 's1', title: 'A!', order: 'a0' },
      { id: 's4', title: 'D', order: 'a3' },
    ]);
    // edited on one side, removed on the other → kept
    expect(
      mergeList(base, [base[0]!, { ...base[1]!, title: 'B2' }], [base[0]!], 'h', 'h'),
    ).toHaveLength(2);
    // both edited → hlc pick
    expect(
      mergeList(
        [base[0]!],
        [{ ...base[0]!, title: 'x' }],
        [{ ...base[0]!, title: 'y' }],
        'h1',
        'h2',
      )[0]!.title,
    ).toBe('y');
    expect(mergeList([], [{ id: 'q' }, { id: 'p' }], [], 'h', 'h').map((i) => i.id)).toEqual([
      'p',
      'q',
    ]);
  });
  it('routine steps use list merge through merge()', () => {
    const b = env(
      { name: 'm', steps: [{ id: 'a', title: 'x', order: 'a0' }] },
      { steps: H(1, 'a') },
      { type: 'routine' },
    );
    const o = env(
      {
        name: 'm',
        steps: [
          { id: 'a', title: 'x', order: 'a0' },
          { id: 'b', title: 'y', order: 'a1' },
        ],
      },
      { steps: H(2, 'a') },
      { type: 'routine' },
    );
    const t = env(
      {
        name: 'm',
        steps: [
          { id: 'a', title: 'x', order: 'a0' },
          { id: 'c', title: 'z', order: 'a2' },
        ],
      },
      { steps: H(3, 'b') },
      { type: 'routine' },
    );
    expect((merge(b, o, t).data['steps'] as unknown[]).length).toBe(3);
  });
  it('delete vs edit: edit wins', () => {
    const del = env(
      baseData,
      { ...baseHlc, [DELETED_KEY]: H(5, 'a') },
      { deletedAt: '2026-10-09T11:00:00.000Z' },
    );
    const edit = env({ ...baseData, title: 'x' }, { ...baseHlc, title: H(6, 'b') });
    const r = mergeDetailed(BASE, del, edit);
    expect(r.envelope.deletedAt).toBeNull();
    expect(r.restored).toBe(true);
    expect(r.envelope.data['title']).toBe('x');
    expect(mergeDetailed(BASE, edit, del).envelope.deletedAt).toBeNull();
  });
  it('delete vs unchanged: deleted', () => {
    const del = env(baseData, { ...baseHlc }, { deletedAt: '2026-10-09T11:00:00.000Z' });
    expect(merge(BASE, del, BASE).deletedAt).toBe('2026-10-09T11:00:00.000Z');
    expect(merge(BASE, BASE, del).deletedAt).toBe('2026-10-09T11:00:00.000Z');
  });
  it('both deleted: deleted (latest timestamp)', () => {
    const d1 = env(baseData, baseHlc, { deletedAt: '2026-10-09T11:00:00.000Z' });
    const d2 = env(baseData, baseHlc, { deletedAt: '2026-10-09T12:00:00.000Z' });
    expect(merge(BASE, d1, d2).deletedAt).toBe('2026-10-09T12:00:00.000Z');
  });
  it('undelete on one side beats a still-deleted base', () => {
    const delBase = env(baseData, baseHlc, { deletedAt: '2026-10-09T11:00:00.000Z' });
    const restored = env(baseData, baseHlc);
    expect(merge(delBase, delBase, restored).deletedAt).toBeNull();
  });
  it('no base: scalar merge with empty base', () => {
    const o = env({ title: 'a' }, { title: H(1, 'a') });
    const t = env({ title: 'b', extra: 1 }, { title: H(2, 'b'), extra: H(2, 'b') });
    const m = merge(null, o, t);
    expect(m.data).toEqual({ title: 'b', extra: 1 });
  });
  it('field removed on one side', () => {
    const o = env({ ...baseData, priority: undefined }, { ...baseHlc, priority: H(3, 'a') });
    expect('priority' in merge(BASE, o, BASE).data).toBe(false);
  });
  it('unknown types merge as scalars', () => {
    const o = env({ v: 1 }, { v: H(2, 'a') }, { type: 'futureThing' });
    const t = env({ v: 2 }, { v: H(3, 'b') }, { type: 'futureThing' });
    expect(merge(null, o, t).data['v']).toBe(2);
  });
  it('stableStringify sorts keys', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe(
      '{"a":[1,{"d":2}],"b":1}',
    );
    expect(stableStringify(undefined)).toBe('undefined');
    expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
  });
});

// --- properties ---------------------------------------------------------------

const word = fc.constantFrom('a', 'b', 'c', 'd');
const lines = fc
  .array(fc.constantFrom('l1', 'l2', 'l3', 'l4', 'x', 'y'), { maxLength: 5 })
  .map((l) => l.join('\n'));

const dataArb = fc.record({
  title: word,
  priority: fc.constantFrom(1, 2, 3, 4),
  notes: lines,
  tags: fc.uniqueArray(word, { maxLength: 3 }),
});

function mutate(base: Envelope, dev: string, tick: number) {
  return fc
    .tuple(dataArb, fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }))
    .map(([d, flags]) => {
      const data: Record<string, unknown> = { ...base.data };
      const fieldHlc = { ...base.fieldHlc };
      const keys = ['title', 'priority', 'notes', 'tags'] as const;
      keys.forEach((k, i) => {
        if (flags[i]) {
          data[k] = d[k];
          fieldHlc[k] = H(tick, dev);
        }
      });
      let deletedAt = base.deletedAt;
      if (flags[4]) {
        deletedAt = deletedAt ? null : `2026-10-09T1${tick % 10}:00:00.000Z`;
        fieldHlc[DELETED_KEY] = H(tick, dev);
      }
      return { ...base, data, fieldHlc, deletedAt, hlc: H(tick, dev) };
    });
}

const triple = dataArb.chain((bd) => {
  const base = env(bd, {
    title: H(1, 'a'),
    priority: H(1, 'a'),
    notes: H(1, 'a'),
    tags: H(1, 'a'),
  });
  return fc.tuple(fc.constant(base), mutate(base, 'a', 5), mutate(base, 'b', 7));
});

describe('merge properties', () => {
  it('is commutative', () => {
    fc.assert(
      fc.property(triple, ([b, o, t]) => {
        expect(stableStringify(merge(b, o, t))).toBe(stableStringify(merge(b, t, o)));
      }),
      { numRuns: 2000 },
    );
  });
  it('is idempotent', () => {
    fc.assert(
      fc.property(triple, ([b, o]) => {
        expect(stableStringify(merge(b, o, o))).toBe(stableStringify(o));
      }),
      { numRuns: 1000 },
    );
  });
  it('merging with an unchanged side returns the other side', () => {
    fc.assert(
      fc.property(triple, ([b, o]) => {
        const m = merge(b, o, b);
        expect(stableStringify(m.data)).toBe(stableStringify(o.data));
        expect(m.deletedAt).toBe(o.deletedAt);
      }),
      { numRuns: 1000 },
    );
  });
  it('never loses a tag added on either side unless the other removed it', () => {
    fc.assert(
      fc.property(triple, ([b, o, t]) => {
        const m = merge(b, o, t).data['tags'] as string[];
        const bt = b.data['tags'] as string[];
        for (const tag of [...(o.data['tags'] as string[]), ...(t.data['tags'] as string[])]) {
          if (!bt.includes(tag)) expect(m).toContain(tag);
        }
      }),
    );
  });
});
