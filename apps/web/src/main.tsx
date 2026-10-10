import { openWorkerDriver } from '@lm/db';
import { claimOwnership, cryptoRng } from '@lm/platform';
import { Boot, type BootPlatform } from '@lm/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// The web shell: SQLite in a worker on OPFS, one owner tab (ADR-011, ADR-021).

const DB_FILE = '/life-manager.sqlite3';

const platform: BootPlatform = {
  claim: ({ steal }) => claimOwnership('life-manager:db', { steal }),
  openDriver: async () => {
    const worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' });
    try {
      return { driver: await openWorkerDriver(worker, DB_FILE), dispose: () => worker.terminate() };
    } catch (error) {
      worker.terminate();
      throw error;
    }
  },
  clock: () => Date.now(),
  rng: cryptoRng,
  languages: navigator.languages,
};

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <Boot platform={platform} />
  </StrictMode>,
);
