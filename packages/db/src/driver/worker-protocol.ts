import type { SqlValue } from './types';

// Messages between the main thread and the SQLite worker (ADR-018).

export type WorkerRequest =
  | { id: number; op: 'open'; fileName: string }
  | { id: number; op: 'run' | 'all'; sql: string; params: SqlValue[] }
  | { id: number; op: 'script'; sql: string }
  | { id: number; op: 'close' };

export type WorkerResponse =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; message: string };

/** The part of `Worker` / `DedicatedWorkerGlobalScope` both sides use. */
export interface MessagePortLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}
