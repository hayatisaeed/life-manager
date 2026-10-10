// Owns the SyncEngine for this device and decides *when* to sync (SYNC.md §5):
// on start and resume, 30 s after the last local edit, every 5 minutes while
// in the foreground, and on "Sync now". Only one tab syncs at a time (Web Locks).

import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { SyncStatus, SyncTransport } from '@lm/sync';
import { GitHubTransport, GitLabTransport, SyncEngine } from '@lm/sync';
import { redact } from '@lm/platform';
import type { Services } from './services';

export interface ForgeConfig {
  kind: 'github' | 'gitlab';
  /** `github.com`, `gitlab.com` or a self-hosted host name. */
  host: string;
  /** `owner/name` (GitHub) or `group/…/project` (GitLab). */
  repo: string;
  branch?: string;
}

export const TOKEN_SECRET = 'forge.token';
const CONFIG_KEY = 'sync.config';

export interface SyncUiState extends SyncStatus {
  configured: boolean;
  config: ForgeConfig | null;
}

const INITIAL: SyncUiState = {
  phase: 'idle',
  lastSyncAt: null,
  error: null,
  progress: null,
  restored: 0,
  conflicts: 0,
  newerSchema: false,
  configured: false,
  config: null,
};

export function makeTransport(services: Pick<Services, 'platform'>, cfg: ForgeConfig, token: string): SyncTransport {
  const host = cfg.host.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (cfg.kind === 'github') {
    const [owner = '', repo = ''] = cfg.repo.split('/');
    const apiBase = host === 'github.com' || host === 'api.github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
    return new GitHubTransport(services.platform.http, {
      apiBase,
      owner,
      repo,
      token,
      ...(cfg.branch ? { branch: cfg.branch } : {}),
    });
  }
  return new GitLabTransport(services.platform.http, {
    baseUrl: `https://${host}`,
    project: cfg.repo,
    token,
    ...(cfg.branch ? { branch: cfg.branch } : {}),
  });
}

export class SyncController {
  readonly ui: UseBoundStore<StoreApi<SyncUiState>> = create<SyncUiState>(() => INITIAL);
  private engine: SyncEngine | null = null;
  private offEngine: (() => void) | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private stopFns: (() => void)[] = [];
  /** Hook for toasts (set by the UI). */
  onEvent: ((e: { kind: 'restored' | 'conflicts'; count: number }) => void) | null = null;

  constructor(private readonly s: Services) {}

  async init(): Promise<void> {
    const cfg = await this.s.store.getDevice<ForgeConfig>(CONFIG_KEY);
    const token = await this.s.platform.secrets.get(TOKEN_SECRET);
    if (cfg && token) this.attach(cfg, token);
  }

  private attach(cfg: ForgeConfig, token: string): void {
    this.offEngine?.();
    this.engine = new SyncEngine({
      store: this.s.store,
      state: this.s.syncState,
      transport: makeTransport(this.s, cfg, token),
      keys: this.s.keys,
      env: this.s.env,
      blobs: this.s.blobs,
    });
    this.offEngine = this.engine.onStatus((st) => {
      const prev = this.ui.getState();
      this.ui.setState({ ...st, configured: true, config: cfg });
      if (st.phase === 'idle' && prev.phase === 'syncing') {
        if (st.restored) this.onEvent?.({ kind: 'restored', count: st.restored });
        if (st.conflicts) this.onEvent?.({ kind: 'conflicts', count: st.conflicts });
      }
    });
  }

  get configured(): boolean {
    return this.engine !== null;
  }

  async connect(cfg: ForgeConfig, token: string): Promise<void> {
    await this.s.platform.secrets.set(TOKEN_SECRET, token);
    await this.s.store.setDevice(CONFIG_KEY, cfg);
    this.attach(cfg, token);
  }

  /** Re-create the engine (e.g. after the data key changed when joining a repo). */
  async reload(): Promise<void> {
    await this.init();
  }

  async updateToken(token: string): Promise<void> {
    const cfg = this.ui.getState().config;
    if (!cfg) return;
    await this.connect(cfg, token);
  }

  async disconnect(): Promise<void> {
    this.stop();
    this.offEngine?.();
    this.engine = null;
    await this.s.platform.secrets.delete(TOKEN_SECRET);
    await this.s.store.setDevice(CONFIG_KEY, null);
    await this.s.syncState.reset(false);
    this.ui.setState(INITIAL);
  }

  async syncNow(): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    const run = async () => {
      try {
        await engine.sync();
      } catch (e) {
        console.warn('sync failed', redact(e));
      }
    };
    const locks = (globalThis.navigator as Navigator | undefined)?.locks;
    if (locks) await locks.request('lm-sync', { ifAvailable: true }, async (lock) => (lock ? run() : undefined));
    else await run();
  }

  async fullResync(): Promise<void> {
    await this.engine?.fullResync();
    await this.syncNow();
  }

  async retryProblems(): Promise<void> {
    await this.engine?.retryProblems();
    await this.syncNow();
  }

  /** Start the automatic triggers. Returns a stop function. */
  start(): () => void {
    this.stop();
    void this.syncNow();
    const tick = () => {
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      if (visible) void this.syncNow();
      this.timers.push(setTimeout(tick, 5 * 60_000));
    };
    this.timers.push(setTimeout(tick, 5 * 60_000));
    this.stopFns.push(
      this.s.store.subscribe(null, (e) => {
        if (e.remote || !this.engine) return;
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => void this.syncNow(), 30_000);
      }),
      this.s.platform.lifecycle.onResume(() => void this.syncNow()),
    );
    return () => this.stop();
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.debounce) clearTimeout(this.debounce);
    for (const f of this.stopFns) f();
    this.stopFns = [];
  }
}
