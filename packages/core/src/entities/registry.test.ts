import { describe, expect, it } from 'vitest';
import dataModel from '../../../../docs/DATA-MODEL.md?raw';
import { parseEntityData } from './envelope';
import { ENTITIES, ENTITY_TYPES, isEntityType, type EntityType } from './registry';
import { FIXTURES, SAMPLE } from './test-fixtures';

// DATA-MODEL.md says the zod schemas must match it, so check the entity list
// against the document itself.
const documented = [...dataModel.matchAll(/^\| \*\*([A-Za-z]+)\*\* \|/gm)].map(
  ([, name = '']) => name.charAt(0).toLowerCase() + name.slice(1),
);

describe('entity registry', () => {
  it('has exactly the entities in DATA-MODEL.md, plus settings', () => {
    expect(documented.length).toBeGreaterThan(40);
    expect([...ENTITY_TYPES].sort()).toEqual([...documented, 'settings'].sort());
  });

  it.each(ENTITY_TYPES)('%s: fixture is valid and round-trips unchanged', (type) => {
    const data = FIXTURES[type];
    expect(parseEntityData(type, data)).toEqual(data);
  });

  it.each(ENTITY_TYPES)(
    '%s: upgraders cover every version, merge kinds name real fields',
    (type) => {
      const def = ENTITIES[type];
      expect(def.upgraders).toHaveLength(def.version - 1);
      for (const field of Object.keys(def.merge))
        expect(Object.hasOwn(def.shape, field)).toBe(true);
      // DATA-MODEL.md §1: these names always mean long text.
      for (const field of ['body', 'notes', 'content']) {
        if (Object.hasOwn(def.shape, field)) expect(def.merge).toHaveProperty(field, 'text');
      }
    },
  );

  it('knows its own types', () => {
    expect(isEntityType('task')).toBe(true);
    expect(isEntityType('toString')).toBe(false);
    expect(isEntityType('nope')).toBe(false);
  });
});

describe('cross-field rules', () => {
  const invalid = (type: EntityType, patch: Record<string, unknown>) => () =>
    parseEntityData(type, { ...FIXTURES[type], ...patch });

  it('a due time needs a due date', () => {
    const { dueDate: _, ...task } = FIXTURES.task;
    expect(() => parseEntityData('task', task)).toThrow(/dueTime needs a dueDate/);
  });
  it('time ranges do not run backwards', () => {
    const backwards = { start: SAMPLE.LATER, end: SAMPLE.AT };
    expect(invalid('event', backwards)).toThrow(/end must not be before start/);
    expect(invalid('timeBlock', backwards)).toThrow(/end must not be before start/);
    expect(invalid('timeEntry', backwards)).toThrow(/end must not be before start/);
  });
  it("an account's opening balance is in its currency", () => {
    expect(invalid('account', { currency: 'EUR' })).toThrow(/opening balance/);
  });
  it('custom health metrics use the custom: prefix', () => {
    expect(
      parseEntityData('healthLog', { ...FIXTURES.healthLog, metric: 'custom:steps' }).metric,
    ).toBe('custom:steps');
    expect(invalid('healthLog', { metric: 'steps' })).toThrow();
  });
  it('habit schedules are validated per kind', () => {
    expect(invalid('habit', { schedule: { kind: 'weekdays', days: [1, 1] } })).toThrow(/Duplicate/);
    expect(invalid('habit', { schedule: { kind: 'daily', days: [1] } })).toThrow();
    expect(
      parseEntityData('habit', {
        ...FIXTURES.habit,
        schedule: { kind: 'timesPer', times: 3, period: 'week' },
      }).schedule,
    ).toEqual({ kind: 'timesPer', times: 3, period: 'week' });
  });
  it('optional fields are absent, never undefined or null', () => {
    expect(invalid('task', { dueDate: undefined, dueTime: undefined })).toThrow();
    expect(invalid('task', { projectId: null })).toThrow();
  });
});
