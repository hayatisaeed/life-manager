import { openMemoryDriver } from '@lm/db/memory';
import type { Ownership } from '@lm/platform';
import { act, fireEvent, screen } from '@testing-library/react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Boot, type BootPlatform } from './Boot';

// Opening the database loads sqlite-wasm and runs every migration; that takes
// over a second on a busy machine, past Testing Library's default.
const OPEN = { timeout: 15_000 };

function ownership() {
  let lose: () => void = () => undefined;
  const lost = new Promise<void>((r) => {
    lose = r;
  });
  const o: Ownership & { lose(): void; released: boolean } = {
    lost,
    released: false,
    release() {
      o.released = true;
    },
    lose,
  };
  return o;
}

function platform(over: Partial<BootPlatform> = {}): BootPlatform {
  return {
    claim: () => Promise.resolve(ownership()),
    openDriver: async () => ({ driver: await openMemoryDriver(), dispose: () => undefined }),
    clock: () => Date.UTC(2026, 2, 21, 6),
    rng: Math.random,
    languages: ['en-US'],
    sleep: () => Promise.resolve(),
    ...over,
  };
}

describe('Boot', () => {
  it('opens the database and shows the app', async () => {
    render(<Boot platform={platform()} />);
    expect(
      await screen.findByRole('heading', { name: /Good (morning|afternoon|evening)/ }, OPEN),
    ).toBeDefined();
  });

  it('starts in the browser language before any settings exist', async () => {
    render(<Boot platform={platform({ languages: ['fa-IR'] })} />);
    expect(await screen.findByRole('heading', { name: /بخیر/ }, OPEN)).toBeDefined();
  });

  it('waits for another tab, takes over on request, and gives up when taken over', async () => {
    const claims: boolean[] = [];
    let current = ownership();
    let disposed = 0;
    render(
      <Boot
        platform={platform({
          claim: ({ steal }) => {
            claims.push(steal);
            if (!steal) return Promise.resolve(null);
            current = ownership();
            return Promise.resolve(current);
          },
          openDriver: async () => ({ driver: await openMemoryDriver(), dispose: () => disposed++ }),
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Use it here' }, OPEN));
    expect(await screen.findByRole('heading', { name: /Good/ }, OPEN)).toBeDefined();
    expect(claims).toEqual([false, true]);
    await act(async () => {
      current.lose();
      await current.lost;
    });
    expect(
      await screen.findByText('Life Manager is open in another tab.', undefined, OPEN),
    ).toBeDefined();
    expect(disposed).toBe(1);
  });

  it('retries opening, then reports the failure and releases the lock', async () => {
    const own = ownership();
    let attempts = 0;
    render(
      <Boot
        platform={platform({
          claim: () => Promise.resolve(own),
          openDriver: () => {
            attempts++;
            return Promise.reject(new Error('files busy'));
          },
        })}
      />,
    );
    expect(
      await screen.findByText('Your data could not be opened.', undefined, OPEN),
    ).toBeDefined();
    expect(screen.getByText('files busy')).toBeDefined();
    expect(attempts).toBe(8);
    expect(own.released).toBe(true);
  });

  it('recovers when a later attempt succeeds', async () => {
    let attempts = 0;
    render(
      <Boot
        platform={platform({
          openDriver: async () => {
            if (++attempts < 3) throw 'busy';
            return { driver: await openMemoryDriver(), dispose: () => undefined };
          },
        })}
      />,
    );
    expect(await screen.findByRole('heading', { name: /Good/ }, OPEN)).toBeDefined();
    expect(attempts).toBe(3);
  });
});
