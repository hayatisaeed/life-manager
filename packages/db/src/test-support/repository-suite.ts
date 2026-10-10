// The repository test suite (ROADMAP P0.5 AC). Framework-free so the same
// cases run under Vitest against the in-memory wasm driver and in Chromium
// against the real worker on opfs-sahpool (e2e/).
import { SETTINGS_ID, type EntityData, type EntityType } from '@lm/core';
import type { SqlDriver } from '../driver/types';
import {
  LmDatabase,
  RecordNotFoundError,
  type ListOptions,
  type RowProblem,
} from '../repo/database';

export interface SuiteCase {
  name: string;
  run(openDriver: () => Promise<SqlDriver>): Promise<void>;
}

export class AssertionError extends Error {
  override name = 'AssertionError';
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new AssertionError(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new AssertionError(`${message}\n  expected ${e}\n  actual   ${a}`);
}

async function rejects(
  p: Promise<unknown>,
  match: RegExp | (new (...a: never[]) => Error),
  message: string,
) {
  try {
    await p;
  } catch (error) {
    const ok =
      match instanceof RegExp
        ? match.test(error instanceof Error ? error.message : String(error))
        : error instanceof match;
    assert(ok, `${message}: wrong error ${String(error)}`);
    return;
  }
  throw new AssertionError(`${message}: did not throw`);
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** A clock tests can move, starting 2026-10-10T00:00:00Z. */
export function fakeClock(start = Date.UTC(2026, 9, 10)) {
  let now = start;
  const clock = () => now;
  clock.advance = (ms: number) => (now += ms);
  clock.set = (ms: number) => (now = ms);
  return clock;
}

/** Deterministic [0, 1) generator (mulberry32). */
export function seededRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const task = (over: Partial<EntityData<'task'>> = {}): EntityData<'task'> => ({
  title: 'Call mom',
  notes: '',
  priority: 2,
  status: 'todo',
  reminders: [],
  tags: [],
  order: 'a0',
  ...over,
});

const note = (title: string, content = ''): EntityData<'note'> => ({
  title,
  content,
  tags: [],
  pinned: false,
});

async function setup(openDriver: () => Promise<SqlDriver>, problems: RowProblem[] = []) {
  const driver = await openDriver();
  const clock = fakeClock();
  const db = await LmDatabase.open({
    driver,
    clock,
    rng: seededRng(),
    onProblem: (p) => problems.push(p),
  });
  return { driver, clock, db };
}

export const REPOSITORY_SUITE: SuiteCase[] = [
  {
    name: 'creates, reads and lists records',
    async run(open) {
      const { db, clock } = await setup(open);
      const a = await db.create('task', task({ title: 'A', dueDate: '2026-10-12' }));
      clock.advance(1000);
      const b = await db.create('task', task({ title: 'B' }));
      assert(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(a.id), 'ULID id');
      equal(a.createdAt, '2026-10-10T00:00:00.000Z', 'createdAt from the injected clock');
      equal(a.fieldHlc, {}, 'new records have no field HLCs');
      assert(a.hlc.endsWith(`-${db.deviceId}`), 'HLC carries the device id');
      equal(await db.get('task', a.id), a, 'get returns what create returned');
      equal(
        (await db.list('task')).map((t) => t.data.title),
        ['A', 'B'],
        'list in id order',
      );
      equal(await db.get('task', 'missing'), null, 'missing → null');
      equal(
        (await db.changeLog()).map((c) => [c.recordId, c.type]),
        [
          [a.id, 'task'],
          [b.id, 'task'],
        ],
        'both creates are in the change log',
      );
      await db.close();
    },
  },
  {
    name: 'updates only the fields that change and stamps their HLCs',
    async run(open) {
      const { db, clock } = await setup(open);
      const t = await db.create('task', task({ dueDate: '2026-10-12' }));
      clock.advance(5);
      const u = await db.update('task', t.id, {
        status: 'done',
        title: 'Call mom',
        dueDate: undefined,
      });
      equal(Object.keys(u.fieldHlc).sort(), ['dueDate', 'status'], 'changed fields only');
      assert(u.hlc > t.hlc && u.fieldHlc['status'] === u.hlc, 'new HLC on record and fields');
      assert(!('dueDate' in u.data), 'undefined removes an optional field');
      const same = await db.update('task', t.id, { status: 'done' });
      equal(same.hlc, u.hlc, 'a no-op update writes nothing');
      const r = await db.update('task', t.id, {
        recurrence: { calendar: 'jalali', freq: 'monthly', interval: 1, mode: 'fixed' },
      });
      const reordered = await db.update('task', t.id, {
        recurrence: { mode: 'fixed', interval: 1, freq: 'monthly', calendar: 'jalali' },
      });
      equal(reordered.hlc, r.hlc, 'key order inside a value is not a change');
      equal((await db.changeLog()).length, 1, 'one change-log row per record');
      equal((await db.changeLog())[0]?.hlc, r.hlc, 'change log has the latest HLC');
      await rejects(db.update('task', t.id, { priority: 9 as 1 }), /./, 'invalid data is rejected');
      equal((await db.get('task', t.id))?.data.priority, 2, 'a rejected update changes nothing');
      await rejects(db.update('task', 'nope', { title: 'x' }), RecordNotFoundError, 'unknown id');
      await db.close();
    },
  },
  {
    name: 'deletes as a tombstone and restores',
    async run(open) {
      const { db } = await setup(open);
      const n = await db.create('note', note('Groceries', 'milk eggs'));
      await db.delete('note', n.id);
      equal(await db.get('note', n.id), null, 'deleted records are hidden');
      const tomb = await db.get('note', n.id, { includeDeleted: true });
      assert(tomb?.deletedAt === '2026-10-10T00:00:00.000Z', 'tombstone keeps deletedAt');
      equal((await db.list('note')).length, 0, 'list hides tombstones');
      equal((await db.list('note', { includeDeleted: true })).length, 1, 'unless asked');
      equal(await db.search('milk'), [], 'search hides tombstones');
      await rejects(db.update('note', n.id, { title: 'x' }), /deleted/, 'no edits to a tombstone');
      await db.delete('note', n.id); // no-op
      await db.restore('note', n.id);
      equal((await db.get('note', n.id))?.deletedAt, null, 'restored');
      equal((await db.search('milk')).length, 1, 'restored records are searchable again');
      await db.close();
    },
  },
  {
    name: 'filters, sorts and limits lists',
    async run(open) {
      const { db } = await setup(open);
      await db.create('task', task({ title: 'c', status: 'done', dueDate: '2026-10-11' }));
      await db.create('task', task({ title: 'a', dueDate: '2026-10-13' }));
      await db.create('task', task({ title: 'b', dueDate: '2026-10-12' }));
      await db.create('task', task({ title: 'd' }));
      const titles = async (opts: ListOptions<'task'>) =>
        (await db.list('task', opts)).map((t) => t.data.title);
      equal(
        await titles({ where: { status: 'todo' }, orderBy: 'dueDate' }),
        ['d', 'b', 'a'],
        'nulls first',
      );
      equal(await titles({ orderBy: 'dueDate', desc: true, limit: 2 }), ['a', 'b'], 'desc + limit');
      equal(await titles({ where: { dueDate: null } }), ['d'], 'null filter');
      equal(await titles({ orderBy: 'createdAt' }), ['c', 'a', 'b', 'd'], 'by createdAt then id');
      await rejects(db.list('task', { orderBy: 'nope' as 'title' }), /no field/, 'unknown field');
      await rejects(
        db.list('task', { where: { "x') OR 1=1 --": 1 } as never }),
        /no field/,
        'no SQL injection',
      );
      await rejects(db.list('nope' as EntityType), /Unknown entity type/, 'unknown type');
      await db.close();
    },
  },
  {
    name: 'searches titles and text with prefixes, in English and Persian',
    async run(open) {
      const { db } = await setup(open);
      const en = await db.create('note', note('Weekly review', 'Plan groceries and the gym'));
      const fa = await db.create('note', note('یادداشت', 'می‌خواهم كتاب بخوانم'));
      const t = await db.create('task', task({ title: 'Buy groceries', notes: '' }));
      const ids = async (q: string, types?: EntityType[]) =>
        (await db.search(q, types ? { types } : {})).map((h) => h.id).sort();
      equal(await ids('groc'), [en.id, t.id].sort(), 'prefix match across types');
      equal(await ids('groceries', ['task']), [t.id], 'type filter');
      equal(await ids('weekly gym'), [en.id], 'all words must match');
      equal((await db.search('groceries'))[0]?.id, t.id, 'title hits rank first');
      equal(await ids('میخواهم'), [fa.id], 'Persian word typed without ZWNJ');
      equal(await ids('خواهم'), [fa.id], 'Persian word part after ZWNJ');
      equal(await ids('کتاب'), [fa.id], 'Arabic kaf in the text matches Persian kaf');
      equal(await ids('"OR NOT* (gym'), [], 'operators are plain text');
      equal(await ids('  '), [], 'empty query');
      await db.update('note', en.id, { content: 'nothing here' });
      equal(await ids('gym'), [], 'index follows updates');
      equal(await db.search('review', { limit: 1 }), [{ type: 'note', id: en.id }], 'limit');
      await db.close();
    },
  },
  {
    name: 'notifies live queries after commits',
    async run(open) {
      const { db } = await setup(open);
      const seen: string[][] = [];
      const off = db.subscribe(['task'], (types) => seen.push([...types].sort()));
      const results: number[] = [];
      const errors: unknown[] = [];
      const stop = db.liveQuery(
        ['note'],
        async (d) => (await d.list('note')).length,
        (n) => results.push(n),
        (e) => errors.push(e),
      );
      await tick();
      const t = await db.create('task', task());
      await db.create('note', note('x'));
      await db.update('task', t.id, { title: 'y' });
      await tick();
      await tick();
      equal(seen, [['task'], ['task']], 'task writes notify; the note write does not');
      equal(results, [0, 1], 'live query re-ran after the note write');
      off();
      stop();
      await db.create('note', note('z'));
      await db.update('task', t.id, { title: 'y' }); // no-op: no notification
      await tick();
      equal(seen.length, 2, 'unsubscribed');
      equal(results, [0, 1], 'stopped');
      const failing = db.liveQuery(
        ['note'],
        () => Promise.reject(new Error('bad')),
        () => undefined,
        (e) => errors.push(e),
      );
      await tick();
      failing();
      equal(errors.length, 1, 'query errors reach onError');
      await db.close();
    },
  },
  {
    name: 'keeps the device id and clock across restarts',
    async run(open) {
      const driver = await open();
      const clock = fakeClock();
      const first = await LmDatabase.open({ driver, clock, rng: seededRng(1) });
      const a = await first.create('task', task());
      clock.set(Date.UTC(2020, 0, 1)); // the device clock jumps backwards
      const second = await LmDatabase.open({ driver, clock, rng: seededRng(2) });
      equal(second.deviceId, first.deviceId, 'device id persisted');
      const b = await second.create('task', task());
      assert(b.hlc > a.hlc, 'HLC never goes backwards across a restart');
      await second.close();
    },
  },
  {
    name: 'uses fixed ids and refuses duplicates',
    async run(open) {
      const { db } = await setup(open);
      const settings: EntityData<'settings'> = {
        language: 'en',
        calendar: 'gregorian',
        weekStart: 1,
        digits: 'latin',
        baseCurrency: 'EUR',
        theme: 'system',
        workingHours: [],
        energyProfile: [],
        lifeWheelAreaIds: [],
        ai: { excludedModules: [] },
      };
      const s = await db.create('settings', settings, { id: SETTINGS_ID });
      equal(s.id, SETTINGS_ID, 'fixed id');
      await rejects(
        db.create('settings', settings, { id: SETTINGS_ID }),
        /already exists/,
        'duplicate',
      );
      equal(await db.search('en'), [], 'settings are not indexed');
      await db.close();
    },
  },
  {
    name: 'keeps unknown envelope keys and reports rows it cannot decode',
    async run(open) {
      const problems: RowProblem[] = [];
      const { db, driver } = await setup(open, problems);
      const t = await db.create('task', task());
      // A record merged from another device can carry extra envelope keys.
      await driver.run('UPDATE ent_task SET extra = ? WHERE id = ?', [
        JSON.stringify({ conflicts: ['notes'], futureKey: 1 }),
        t.id,
      ]);
      const u = await db.update('task', t.id, { title: 'kept' });
      equal([u['conflicts'], u['futureKey']], [['notes'], 1], 'extra keys survive an update');
      equal(
        (await driver.all('SELECT extra FROM ent_task WHERE id = ?', [t.id]))[0],
        { extra: JSON.stringify({ conflicts: ['notes'], futureKey: 1 }) },
        'and are stored',
      );
      await driver.run(`UPDATE ent_task SET schema = 99 WHERE id = ?`, [t.id]);
      equal(await db.list('task'), [], 'an undecodable row is skipped');
      equal(
        problems.map((p) => [p.id, p.reason]),
        [[t.id, 'futureSchema']],
        'and reported',
      );
      equal((await driver.all('SELECT count(*) AS n FROM ent_task'))[0], { n: 1 }, 'never deleted');
      await rejects(db.update('task', t.id, { title: 'x' }), RecordNotFoundError, 'not editable');
      await db.close();
    },
  },
  {
    name: 'rolls back a failed write completely',
    async run(open) {
      const { db, driver } = await setup(open);
      await driver.script(
        "CREATE TRIGGER boom BEFORE INSERT ON change_log BEGIN SELECT RAISE(ABORT, 'boom'); END",
      );
      await rejects(db.create('note', note('x', 'y')), /boom/, 'the write fails');
      equal((await driver.all('SELECT count(*) AS n FROM ent_note'))[0], { n: 0 }, 'no row');
      equal(
        (await driver.all('SELECT count(*) AS n FROM search_doc'))[0],
        { n: 0 },
        'no index entry',
      );
      await db.close();
    },
  },
];
