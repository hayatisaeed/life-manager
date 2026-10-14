/** SYNC.md §5: the host shares this lock across tabs; device-local queues alone cannot do that. */
export function createWebSyncLock(vaultId: string) {
  if (!/^[0-9a-f]{64}$/.test(vaultId)) throw new Error('Invalid vault identity');
  if (!navigator.locks) throw new Error('Cross-tab sync locking unavailable');
  return {
    run: <T>(work: () => Promise<T>) =>
      navigator.locks.request(`life-manager-sync-${vaultId}`, { mode: 'exclusive' }, work),
  };
}
