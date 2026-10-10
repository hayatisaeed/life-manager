// Multi-device convergence simulator (ROADMAP P0.6, ARCHITECTURE.md §15):
// N devices make random concurrent edits and sync in random order; afterwards
// every device must hold byte-identical records.

import type { EntityType } from '@lm/core';
import { FakeTransport } from '../src';
import type { Device } from './helpers';
import { makeDevice, seededForge, snapshot, task } from './helpers';

function prng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(a: readonly T[]): T => a[Math.floor(next() * a.length)] as T,
  };
}

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'eps', 'zeta'];
const TAGS = ['home', 'work', 'urgent', 'later'];

export interface SimOptions {
  seed: number;
  devices?: number;
  ops?: number;
  mode?: 'github' | 'gitlab';
  truncate?: boolean;
}

export async function simulate(
  o: SimOptions,
): Promise<{ converged: boolean; snapshots: string[]; records: number }> {
  const rnd = prng(o.seed);
  const forge = await seededForge({
    mode: o.mode ?? 'github',
    truncateRecursive: o.truncate ?? false,
  });
  const devices: Device[] = [];
  for (let i = 0; i < (o.devices ?? 5); i++) devices.push(await makeDevice(forge, o.seed * 31 + i));
  const ids: { id: string; type: EntityType }[] = [];

  // Occasionally another device commits while one is mid-sync (CAS races).
  forge.beforeOp = async (op) => {
    if (op === 'commit' && rnd.next() < 0.15) {
      const save = forge.beforeOp;
      forge.beforeOp = null;
      const idle = devices.filter((x) => !x.engine.isRunning);
      if (idle.length)
        await rnd
          .pick(idle)
          .engine.sync()
          .catch(() => undefined);
      forge.beforeOp = save;
    }
  };

  for (let step = 0; step < (o.ops ?? 200); step++) {
    const d = rnd.pick(devices);
    d.env.advance(rnd.int(5000));
    const r = rnd.next();
    try {
      if (r < 0.15 || ids.length === 0) {
        if (rnd.next() < 0.5) {
          const t = await d.store.create(
            'task',
            task(rnd.pick(WORDS), { notes: 'l1\nl2\nl3\nl4' }),
          );
          ids.push({ id: t.id, type: 'task' });
        } else {
          const n = await d.store.create('note', {
            title: rnd.pick(WORDS),
            content: 'a\nb\nc\nd',
            tags: [],
            pinned: false,
          });
          ids.push({ id: n.id, type: 'note' });
        }
      } else if (r < 0.7) {
        const { id, type } = rnd.pick(ids);
        const cur = await d.store.getEnvelope(id);
        if (!cur) continue; // this device hasn't seen it yet
        if (cur.deletedAt) {
          if (rnd.next() < 0.3) await d.store.restore(id);
          continue;
        }
        if (cur.schema > 1) continue;
        if (type === 'task') {
          const k = rnd.int(4);
          if (k === 0) await d.store.update('task', id, { title: rnd.pick(WORDS) });
          else if (k === 1)
            await d.store.update('task', id, { priority: rnd.pick([1, 2, 3, 4] as const) });
          else if (k === 2) {
            const tags = new Set((cur.data['tags'] as string[]) ?? []);
            const tag = rnd.pick(TAGS);
            if (tags.has(tag)) tags.delete(tag);
            else tags.add(tag);
            await d.store.update('task', id, { tags: [...tags] });
          } else {
            const lines = String(cur.data['notes'] ?? '').split('\n');
            lines[rnd.int(lines.length)] = rnd.pick(WORDS);
            await d.store.update('task', id, { notes: lines.join('\n') });
          }
        } else {
          const lines = String(cur.data['content'] ?? '').split('\n');
          if (rnd.next() < 0.5) lines[rnd.int(lines.length)] = rnd.pick(WORDS);
          else lines.splice(rnd.int(lines.length + 1), 0, rnd.pick(WORDS));
          await d.store.update('note', id, { content: lines.join('\n') });
        }
      } else if (r < 0.8) {
        const { id } = rnd.pick(ids);
        if (await d.store.getEnvelope(id)) await d.store.remove(id);
      } else {
        await d.engine.sync();
      }
    } catch (e) {
      if (!(e instanceof Error && /Too many concurrent/.test(e.message))) throw e;
    }
  }

  // Quiesce: sync everyone until nothing is dirty and heads agree.
  forge.beforeOp = null;
  for (let round = 0; round < 10; round++) {
    for (const d of devices) await d.engine.sync();
    const dirty = await Promise.all(devices.map((d) => d.store.dirty()));
    if (dirty.every((x) => x.length === 0)) break;
  }
  for (const d of devices) await d.engine.sync();
  const snapshots = await Promise.all(devices.map(snapshot));
  void FakeTransport;
  return { converged: snapshots.every((s) => s === snapshots[0]), snapshots, records: ids.length };
}
