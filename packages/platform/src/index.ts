// Platform adapter interfaces and web/Tauri/Capacitor implementations.
// The full set (sql, http, secrets, notifications, …) arrives in P0.7.
export { assertFileName, createMemoryFileStore, type FileStore } from './files/file-store';
export { openOpfsFileStore } from './files/opfs';
