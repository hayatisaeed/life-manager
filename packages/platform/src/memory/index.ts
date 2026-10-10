// An in-memory Platform for tests, Ladle stories and the convergence simulator.

import { fetchHttpClient } from '../http';
import type { HttpClient, Platform, ScheduledNotification } from '../types';
import { memoryDriver } from '../wasm-sql';

export interface MemoryPlatform extends Platform {
  scheduled: ScheduledNotification[];
  shown: Omit<ScheduledNotification, 'at'>[];
  secretsMap: Map<string, string>;
  saved: { name: string; bytes: Uint8Array; mime: string }[];
}

export function createMemoryPlatform(opts: { http?: HttpClient } = {}): MemoryPlatform {
  const secretsMap = new Map<string, string>();
  const p: MemoryPlatform = {
    scheduled: [],
    shown: [],
    secretsMap,
    saved: [],
    info: {
      kind: 'memory',
      os: 'unknown',
      appVersion: '0.0.0-test',
      caps: {
        nativeHttp: true,
        localTranscription: false,
        backgroundNotifications: false,
        globalHotkey: false,
      },
    },
    openDatabase: () => memoryDriver(),
    http: opts.http ?? fetchHttpClient(),
    secrets: {
      get: async (n) => secretsMap.get(n) ?? null,
      set: async (n, v) => {
        secretsMap.set(n, v);
      },
      delete: async (n) => {
        secretsMap.delete(n);
      },
    },
    notifications: {
      permission: async () => 'granted',
      requestPermission: async () => true,
      scheduleAll: async (items) => {
        p.scheduled = [...items];
      },
      showNow: async (n) => {
        p.shown.push(n);
      },
    },
    files: {
      pick: async () => [],
      save: async (name, bytes, mime) => {
        p.saved.push({ name, bytes, mime });
      },
    },
    audio: {
      available: async () => false,
      start: async () => {
        throw new Error('audio unavailable');
      },
      stop: async () => {
        throw new Error('audio unavailable');
      },
      cancel: async () => undefined,
    },
    lifecycle: {
      onResume: () => () => undefined,
      onDeepLink: () => () => undefined,
    },
    openExternal: async () => undefined,
  };
  return p;
}
