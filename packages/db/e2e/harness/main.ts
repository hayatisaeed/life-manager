// Runs the repository suite in Chromium through the real SQLite worker on
// opfs-sahpool, plus persistence and OPFS attachment checks (ROADMAP P0.5 AC).
import { deriveSubKeys, initCrypto, type DataKey } from '@lm/crypto';
import { openOpfsFileStore } from '@lm/platform';
import { AttachmentStore } from '../../src/attachments';
import { openWorkerDriver } from '../../src/driver/worker-client';
import { LmDatabase } from '../../src/repo/database';
import { REPOSITORY_SUITE, fakeClock, seededRng } from '../../src/test-support/repository-suite';

interface Result {
  name: string;
  ok: boolean;
  error?: string;
}

const worker = new Worker(new URL('../../src/web/sqlite.worker.ts', import.meta.url), {
  type: 'module',
});
let fileNo = 0;
const freshDriver = () =>
  openWorkerDriver(worker, `/suite-${String(Date.now())}-${String(fileNo++)}.sqlite3`);

async function check(name: string, fn: () => Promise<void>): Promise<Result> {
  try {
    await fn();
    return { name, ok: true };
  } catch (error) {
    return {
      name,
      ok: false,
      error: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
    };
  }
}

async function run(): Promise<Result[]> {
  const results: Result[] = [];
  for (const c of REPOSITORY_SUITE) results.push(await check(c.name, () => c.run(freshDriver)));

  results.push(
    await check('persists across a new worker (OPFS)', async () => {
      const file = `/persist-${String(Date.now())}.sqlite3`;
      const first = await LmDatabase.open({
        driver: await openWorkerDriver(worker, file),
        clock: fakeClock(),
        rng: seededRng(),
      });
      const note = await first.create('note', {
        title: 'kept on disk',
        content: '',
        tags: [],
        pinned: false,
      });
      await first.close();
      worker.terminate();
      const second = new Worker(new URL('../../src/web/sqlite.worker.ts', import.meta.url), {
        type: 'module',
      });
      const reopened = await LmDatabase.open({
        driver: await openWorkerDriver(second, file),
        clock: fakeClock(),
        rng: seededRng(),
      });
      const got = await reopened.get('note', note.id);
      if (got?.data.title !== 'kept on disk') throw new Error('record not persisted');
      if (reopened.deviceId !== first.deviceId) throw new Error('device id not persisted');
      await reopened.close();
      second.terminate();
    }),
  );

  results.push(
    await check('stores encrypted attachments in OPFS', async () => {
      await initCrypto();
      const store = new AttachmentStore(
        await openOpfsFileStore('attachments-test'),
        deriveSubKeys(new Uint8Array(32).fill(7) as DataKey),
      );
      const bytes = new TextEncoder().encode(`scan ${String(Date.now())}`);
      const ref = await store.put(bytes, 'text/plain');
      const back = await store.get(ref.hash);
      if (new TextDecoder().decode(back ?? new Uint8Array()) !== new TextDecoder().decode(bytes)) {
        throw new Error('attachment round trip failed');
      }
      await store.delete(ref.hash);
      if (await store.has(ref.hash)) throw new Error('delete failed');
    }),
  );
  return results;
}

const out = document.getElementById('out');
run().then(
  (results) => {
    (window as unknown as { __results: Result[] }).__results = results;
    if (out) out.textContent = JSON.stringify(results, null, 2);
  },
  (error: unknown) => {
    (window as unknown as { __results: Result[] }).__results = [
      { name: 'harness', ok: false, error: String(error) },
    ];
  },
);
