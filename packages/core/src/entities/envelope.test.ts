import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineEntity, type EntityDef } from './define';
import { decodeRecord, parseEntityData, stashUnknownFields } from './envelope';
import { ENTITY_TYPES } from './registry';
import { FIXTURES, SAMPLE } from './test-fixtures';

const HLC_A = '2026-10-09T10:15:00.000Z-0000-devA';
const HLC_B = '2026-10-09T10:16:00.000Z-0003-devB';

const envelope = (patch: Record<string, unknown> = {}) => ({
  id: SAMPLE.ID,
  type: 'task',
  schema: 1,
  hlc: HLC_B,
  fieldHlc: { title: HLC_A, notes: HLC_B },
  deletedAt: null,
  createdAt: SAMPLE.AT,
  data: FIXTURES.task,
  ...patch,
});

describe('decodeRecord', () => {
  it.each(ENTITY_TYPES)('decodes a %s', (type) => {
    const result = decodeRecord(envelope({ type, data: FIXTURES[type] }));
    expect(result).toEqual({
      status: 'ok',
      record: envelope({ type, data: FIXTURES[type] }),
      upgradedFrom: null,
    });
  });

  it('keeps tombstones and envelope keys from newer clients', () => {
    const raw = envelope({ deletedAt: SAMPLE.LATER, hasConflict: true });
    const result = decodeRecord(raw);
    expect(result.status === 'ok' && result.record).toEqual(raw);
  });

  it('moves unknown data fields into _unknown instead of dropping them', () => {
    const raw = envelope({ data: { ...FIXTURES.task, colour: 'red', _unknown: { old: 1 } } });
    const result = decodeRecord(raw);
    expect(result.status === 'ok' && result.record.data).toEqual({
      ...FIXTURES.task,
      _unknown: { old: 1, colour: 'red' },
    });
  });

  it.each([
    ['malformedEnvelope', 'not an object'],
    ['malformedEnvelope', envelope({ id: 'lowercase-not-ulid' })],
    ['malformedEnvelope', envelope({ hlc: 'yesterday' })],
    ['malformedEnvelope', envelope({ fieldHlc: { title: 'x' } })],
    ['malformedEnvelope', envelope({ fieldHlc: [] })],
    ['malformedEnvelope', envelope({ data: new Map() })],
    ['malformedEnvelope', envelope({ schema: 0 })],
    ['unknownType', envelope({ type: 'hologram' })],
    ['unknownType', envelope({ type: 'constructor' })],
    ['futureSchema', envelope({ schema: 2 })],
    ['invalidData', envelope({ data: { ...FIXTURES.task, priority: 9 } })],
    ['invalidData', envelope({ data: { ...FIXTURES.task, _unknown: 'oops' } })],
  ])('keeps the raw record when %s', (reason, raw) => {
    const result = decodeRecord(raw);
    expect(result).toMatchObject({ status: 'kept', reason, raw });
    expect(result.status === 'kept' && result.issues.length).toBeGreaterThan(0);
  });
});

describe('schema upgrades', () => {
  // A made-up entity on schema 3:
  // v1 → v2 renamed `name` to `title`; v2 → v3 added `done`.
  const widget = defineEntity(
    { title: z.string(), done: z.boolean() },
    {
      version: 3,
      upgraders: [
        ({ data, fieldHlc }) => {
          const { name, ...rest } = data;
          const { name: nameHlc, ...hlcRest } = fieldHlc;
          return {
            data: { ...rest, title: name },
            fieldHlc: nameHlc === undefined ? hlcRest : { ...hlcRest, title: nameHlc },
          };
        },
        ({ data, fieldHlc }) => ({ data: { ...data, done: false }, fieldHlc: { ...fieldHlc } }),
      ],
    },
  );
  const registry: Record<string, EntityDef> = { widget };
  const v1 = envelope({
    type: 'widget',
    data: { name: 'Gear', size: 3 },
    fieldHlc: { name: HLC_A },
  });

  it('runs every upgrader in order and renames field HLCs', () => {
    expect(decodeRecord(v1, registry)).toEqual({
      status: 'ok',
      record: {
        ...v1,
        schema: 3,
        fieldHlc: { title: HLC_A },
        data: { title: 'Gear', done: false, _unknown: { size: 3 } },
      },
      upgradedFrom: 1,
    });
  });

  it('starts from the stored version', () => {
    const v2 = envelope({ type: 'widget', schema: 2, data: { title: 'Gear' }, fieldHlc: {} });
    const result = decodeRecord(v2, registry);
    expect(result).toMatchObject({
      status: 'ok',
      upgradedFrom: 2,
      record: { data: { done: false } },
    });
  });

  it('keeps the raw record when an upgrader is missing or throws', () => {
    const gap = { widget: { ...widget, upgraders: [] } };
    expect(decodeRecord(v1, gap)).toMatchObject({ status: 'kept', reason: 'upgradeFailed' });

    for (const thrown of [new Error('boom'), 'boom']) {
      const broken = {
        widget: {
          ...widget,
          upgraders: [
            () => {
              throw thrown;
            },
          ],
        },
      };
      const result = decodeRecord(v1, broken);
      expect(result).toMatchObject({ status: 'kept', reason: 'upgradeFailed', raw: v1 });
      expect(result.status === 'kept' && result.issues[0]).toContain('boom');
    }
  });
});

describe('stashUnknownFields', () => {
  const def = { shape: { a: z.string() } };
  it('leaves known-only data alone', () => {
    expect(stashUnknownFields(def, { a: 'x' })).toEqual({ a: 'x' });
  });
  it('keeps an existing _unknown even with nothing new', () => {
    expect(stashUnknownFields(def, { a: 'x', _unknown: { z: 1 } })).toEqual({
      a: 'x',
      _unknown: { z: 1 },
    });
  });
  it('passes a malformed _unknown through for validation to reject', () => {
    expect(stashUnknownFields(def, { a: 'x', _unknown: [1], b: 2 })).toEqual({
      a: 'x',
      _unknown: [1],
    });
  });

  it('keeps a __proto__ key as data', () => {
    const data = JSON.parse('{"a":"x","__proto__":{"polluted":true}}') as Record<string, unknown>;
    const out = stashUnknownFields(def, data);
    expect(Object.getPrototypeOf(out['_unknown'])).toBe(Object.prototype);
    expect(Object.keys(out['_unknown'] as object)).toEqual(['__proto__']);
  });

  it('keeps __proto__ keys through a full decode', () => {
    const raw = JSON.parse(
      JSON.stringify(envelope({ fieldHlc: { title: HLC_A, notes: HLC_B } }))
        .replace('"notes":"' + HLC_B + '"', '"notes":"' + HLC_B + '","__proto__":"' + HLC_A + '"')
        .replace('"order":"a0"', '"order":"a0","__proto__":{"p":1}'),
    ) as unknown;
    const result = decodeRecord(raw);
    if (result.status !== 'ok') throw new Error(result.issues.join());
    expect(Object.getOwnPropertyDescriptor(result.record.fieldHlc, '__proto__')?.value).toBe(HLC_A);
    expect(
      Object.getOwnPropertyDescriptor(result.record.data._unknown, '__proto__')?.value,
    ).toEqual({ p: 1 });
  });

  it('keeps a __proto__ envelope key', () => {
    const raw = JSON.parse(
      JSON.stringify(envelope()).replace('{"id"', '{"__proto__":{"x":1},"id"'),
    ) as unknown;
    const result = decodeRecord(raw);
    expect(
      result.status === 'ok' && Object.getOwnPropertyDescriptor(result.record, '__proto__')?.value,
    ).toEqual({
      x: 1,
    });
  });

  it('keeps a __proto__ key through validation too', () => {
    const data = JSON.parse('{"name":"x","color":"teal","__proto__":{"p":1}}') as unknown;
    const out = parseEntityData('tag', data) as Record<string, unknown>;
    expect(Object.getOwnPropertyDescriptor(out['_unknown'], '__proto__')?.value).toEqual({ p: 1 });
  });

  it('never loses a key (property)', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (data) => {
        fc.pre(!('_unknown' in data));
        const out = stashUnknownFields(def, data);
        const stash = (out['_unknown'] ?? {}) as Record<string, unknown>;
        for (const [key, value] of Object.entries(data)) {
          const holder = key === 'a' ? out : stash;
          expect(Object.getOwnPropertyDescriptor(holder, key)?.value).toEqual(value);
        }
      }),
      { numRuns: 1000, examples: [[{ ['__proto__']: 1 }]] },
    );
  });
});

describe('parseEntityData', () => {
  it('rejects non-objects and invalid data loudly', () => {
    expect(() => parseEntityData('tag', null)).toThrow(TypeError);
    expect(() => parseEntityData('tag', ['x'])).toThrow(TypeError);
    expect(() => parseEntityData('tag', { name: 'x', color: '#fff' })).toThrow();
  });

  it('is idempotent on decoded records (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ENTITY_TYPES), fc.string(), (type, extra) => {
        const once = parseEntityData(type, { ...FIXTURES[type], zzExtra: extra });
        expect(parseEntityData(type, once)).toEqual(once);
      }),
    );
  });
});
