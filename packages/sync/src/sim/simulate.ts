// Multi-device convergence simulator (ROADMAP P0.6, ARCHITECTURE.md §15).
//
// N devices share one fake forge. Each step one random device does one random
// thing: create, edit, delete or restore a record, or sync. Sometimes another
// device syncs in the middle of a push, which forces real compare-and-swap
// conflicts. At the end every device syncs until nothing changes, and then
// they must all hold exactly the same records, and every record ever created
// must still exist somewhere (deleted records as tombstones).
import type { EntityData, EntityRecord, Rng } from '@lm/core';
import {
  device,
  initializedForge,
  note,
  seededRng,
  task,
  type Device,
} from '../test-support/devices';
import type { SyncOutcome } from '../engine';

export interface SimOptions {
  seed: number;
  devices: number;
  ops: number;
  /** The forge's CAS semantics: GitHub's ('branch', the default) or GitLab's. */
  cas?: 'branch' | 'perFile';
}

export interface SimReport {
  seed: number;
  converged: boolean;
  /** Why it failed, for the test message. */
  problems: string[];
  records: number;
  syncs: number;
  /** Syncs that gave up after all retries (allowed; the final rounds must still converge). */
  conflicts: number;
  /** Commits the forge refused because another device got there first. */
  casRejections: number;
  /** Commits that landed on a newer head than their parent ('perFile' only). */
  rebased: number;
}

type Synced = 'task' | 'note';
const TYPES: Synced[] = ['task', 'note'];
const WORDS = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'.split(' ');
const TAGS = [
  '01J9ZT0000000000000000TAG1',
  '01J9ZT0000000000000000TAG2',
  '01J9ZT0000000000000000TAG3',
];

export async function simulate({ seed, devices: count, ops, cas }: SimOptions): Promise<SimReport> {
  const rng = seededRng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)] as T;
  const forge = initializedForge(cas ? { cas } : {});
  const start = Date.UTC(2026, 9, 10);
  const devices: Device[] = [];
  for (let i = 0; i < count; i++) {
    // Clocks disagree by up to ±5 minutes; HLCs must still order edits.
    const skew = Math.round((rng() - 0.5) * 600_000);
    devices.push(
      await device(
        forge,
        seed * 100 + i,
        { maxAttempts: 8, batchSize: 7, maxFilesPerCommit: 9 },
        start + skew,
      ),
    );
  }
  const created = new Set<string>();
  const problems: string[] = [];
  let syncs = 0;
  let conflicts = 0;

  const sync = async (d: Device): Promise<SyncOutcome> => {
    syncs++;
    const out = await d.engine.sync();
    if (out.status === 'conflict') conflicts++;
    else if (out.status !== 'ok') problems.push(`sync failed: ${JSON.stringify(out)}`);
    return out;
  };

  for (let step = 0; step < ops; step++) {
    const advance = Math.floor(rng() * 2000);
    for (const d of devices) d.clock.now += advance;
    const d = pick(devices);
    const roll = rng();
    if (roll < 0.25) {
      const type = pick(TYPES);
      const r =
        type === 'task'
          ? await d.db.create('task', task({ title: words(rng, 2) }))
          : await d.db.create('note', note(words(rng, 2), lines(rng)));
      created.add(r.id);
    } else if (roll < 0.62) {
      await edit(d, rng);
    } else if (roll < 0.7) {
      const r = await randomRecord(d, rng, false);
      if (r) await d.db.delete(r.type, r.id);
    } else if (roll < 0.74) {
      const r = await randomRecord(d, rng, true);
      if (r?.deletedAt) await d.db.restore(r.type, r.id);
    } else {
      if (rng() < 0.15) {
        // Another device syncs while this one is mid-push: a real CAS race.
        const other = pick(devices);
        d.hooks.beforeCommit = async () => {
          delete d.hooks.beforeCommit;
          if (other !== d) await sync(other);
        };
      }
      await sync(d);
      delete d.hooks.beforeCommit;
    }
  }

  // Quiesce: sync everyone in turn until a full round changes nothing.
  let quiet = false;
  for (let round = 0; round < 12 && !quiet; round++) {
    quiet = true;
    for (const d of devices) {
      const out = await sync(d);
      if (out.status !== 'ok' || out.pulled > 0 || out.pushed > 0) quiet = false;
    }
  }
  if (!quiet) problems.push('devices did not reach a quiet state');

  const snapshots = await Promise.all(devices.map(snapshot));
  const first = snapshots[0] ?? '';
  snapshots.forEach((s, i) => {
    if (s !== first) problems.push(`device ${String(i)} differs from device 0`);
  });
  const ids = new Set((JSON.parse(first) as { id: string }[]).map((r) => r.id));
  for (const id of created) if (!ids.has(id)) problems.push(`record ${id} was lost`);
  for (const [i, d] of devices.entries()) {
    const kept = await d.db.keptFiles();
    if (kept.length > 0) problems.push(`device ${String(i)} kept ${String(kept.length)} files`);
    if ((await d.db.changeLog()).length > 0)
      problems.push(`device ${String(i)} still has unpushed changes`);
  }
  for (const d of devices) await d.db.close();
  return {
    seed,
    converged: problems.length === 0,
    problems,
    records: ids.size,
    syncs,
    conflicts,
    casRejections: forge.rejected,
    rebased: forge.rebased,
  };
}

async function randomRecord(
  d: Device,
  rng: Rng,
  includeDeleted: boolean,
): Promise<EntityRecord<Synced> | null> {
  const type = TYPES[Math.floor(rng() * TYPES.length)] as Synced;
  const all: EntityRecord<Synced>[] = await d.db.list(type, { includeDeleted });
  return all.length === 0 ? null : (all[Math.floor(rng() * all.length)] ?? null);
}

async function edit(d: Device, rng: Rng): Promise<void> {
  const r = await randomRecord(d, rng, false);
  if (!r) return;
  const roll = rng();
  const tags = toggle(r.data.tags, TAGS[Math.floor(rng() * TAGS.length)] ?? '');
  if (r.type === 'task') {
    const data = r.data as EntityData<'task'>;
    const patch: Partial<EntityData<'task'>> =
      roll < 0.3
        ? { title: words(rng, 2) }
        : roll < 0.5
          ? {
              status:
                (['todo', 'doing', 'done', 'cancelled'] as const)[Math.floor(rng() * 4)] ?? 'todo',
            }
          : roll < 0.65
            ? { priority: (Math.floor(rng() * 4) + 1) as 1 | 2 | 3 | 4 }
            : roll < 0.85
              ? { notes: editText(data.notes, rng) }
              : { tags };
    await d.db.update('task', r.id, patch);
  } else {
    const data = r.data as EntityData<'note'>;
    const patch: Partial<EntityData<'note'>> =
      roll < 0.2
        ? { title: words(rng, 2) }
        : roll < 0.75
          ? { content: editText(data.content, rng) }
          : roll < 0.85
            ? { pinned: !data.pinned }
            : { tags };
    await d.db.update('note', r.id, patch);
  }
}

function toggle(xs: readonly string[], x: string): string[] {
  return xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x];
}

function words(rng: Rng, n: number): string {
  return Array.from({ length: n }, () => WORDS[Math.floor(rng() * WORDS.length)]).join(' ');
}

function lines(rng: Rng): string {
  return Array.from({ length: 1 + Math.floor(rng() * 4) }, () => words(rng, 3)).join('\n');
}

/** Insert, replace or delete one line: the edits diff3 merges or flags. */
function editText(text: string, rng: Rng): string {
  const ls = text === '' ? [] : text.split('\n');
  const at = Math.floor(rng() * (ls.length + 1));
  const roll = rng();
  if (roll < 0.4 || ls.length === 0) ls.splice(at, 0, words(rng, 3));
  else if (roll < 0.8) ls.splice(Math.min(at, ls.length - 1), 1, words(rng, 3));
  else ls.splice(Math.min(at, ls.length - 1), 1);
  return ls.join('\n');
}

async function snapshot(d: Device): Promise<string> {
  const all: EntityRecord[] = [];
  for (const type of TYPES) all.push(...(await d.db.list(type, { includeDeleted: true })));
  all.sort((a, b) => (a.id < b.id ? -1 : 1));
  return JSON.stringify(all);
}
