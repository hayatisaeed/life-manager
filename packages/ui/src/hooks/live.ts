// Live queries (ARCHITECTURE.md §4): re-run a read whenever records of the
// given types change, locally or through sync.

import { useEffect, useRef, useState } from 'react';
import type { EntityType, Rec } from '@lm/core';
import type { ListOptions, Store } from '@lm/db';
import { useServices } from '../app/context';

export function useLive<T>(fn: (store: Store) => Promise<T>, deps: readonly unknown[], types: readonly string[] | null): T | undefined {
  const { store } = useServices();
  const [value, setValue] = useState<T | undefined>(undefined);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let cancelled = false;
    let version = 0;
    const run = () => {
      const v = ++version;
      fnRef
        .current(store)
        .then((r) => {
          if (!cancelled && v === version) setValue(r);
        })
        .catch((e: unknown) => console.error('live query failed', e));
    };
    run();
    const off = store.subscribe(types, run);
    return () => {
      cancelled = true;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the caller's query inputs
  }, [store, ...deps, types?.join(',')]);
  return value;
}

export function useList<T extends EntityType>(type: T, opts: ListOptions = {}, deps: readonly unknown[] = []): Rec<T>[] | undefined {
  return useLive((s) => s.list(type, opts), [type, opts.where, opts.orderBy, opts.limit, JSON.stringify(opts.params), ...deps], [type]);
}

export function useRecord<T extends EntityType>(type: T, id: string | null | undefined): Rec<T> | null | undefined {
  return useLive((s) => (id ? s.get(type, id) : Promise.resolve(null)), [type, id], [type]);
}

export function useDevice<T>(key: string): T | null | undefined {
  return useLive((s) => s.getDevice<T>(key), [key], [`device:${key}`]);
}
