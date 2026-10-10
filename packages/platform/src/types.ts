// Platform adapter interfaces (ARCHITECTURE.md §2, §14). Everything native goes
// through these so the domain and UI stay platform-agnostic.

export type SqlValue = string | number | null | Uint8Array;
export type Row = Record<string, SqlValue>;

export interface SqlStatement {
  sql: string;
  params?: SqlValue[];
}

/** One SQLite connection. Implementations must execute calls in order. */
export interface SqlDriver {
  exec(sql: string, params?: SqlValue[]): Promise<void>;
  query<T extends Row = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Runs the statements atomically in one transaction. */
  batch(statements: SqlStatement[]): Promise<void>;
  close(): Promise<void>;
}

export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'PROPFIND' | 'REPORT';
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** Abort after this many ms. */
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  bytes(): Uint8Array;
  text(): string;
  json<T = unknown>(): T;
}

export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}

/** OS keychain / Keystore / encrypted IndexedDB (SECURITY.md §4). */
export interface SecretStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

export interface ScheduledNotification {
  /** Stable id so re-scheduling replaces instead of duplicating. */
  id: string;
  at: number; // epoch ms
  title: string;
  body?: string;
  /** Deep link opened when the notification is tapped. */
  link?: string;
}

export interface Notifier {
  permission(): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission(): Promise<boolean>;
  /** Replace all pending notifications with this set. */
  scheduleAll(items: ScheduledNotification[]): Promise<void>;
  showNow(n: Omit<ScheduledNotification, 'at'>): Promise<void>;
}

export interface PickedFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface FileService {
  pick(opts: { accept?: string[]; multiple?: boolean; capture?: boolean }): Promise<PickedFile[]>;
  save(name: string, bytes: Uint8Array, mime: string): Promise<void>;
}

export interface Recording {
  bytes: Uint8Array;
  mime: string;
  durationMs: number;
}

export interface AudioRecorder {
  available(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<Recording>;
  cancel(): Promise<void>;
}

export interface Lifecycle {
  /** Called when the app returns to the foreground. */
  onResume(cb: () => void): () => void;
  onDeepLink(cb: (url: string) => void): () => void;
  /** Desktop global hotkey for quick capture; no-op elsewhere. */
  registerGlobalHotkey?(accelerator: string, cb: () => void): Promise<() => void>;
}

export interface PlatformInfo {
  kind: 'web' | 'tauri' | 'capacitor' | 'memory';
  os: 'macos' | 'windows' | 'linux' | 'android' | 'ios' | 'web' | 'unknown';
  appVersion: string;
  /** Feature flags the UI uses to hide unavailable features (ARCHITECTURE.md §14). */
  caps: {
    /** Can reach hosts without CORS headers (CalDAV, some ICS). */
    nativeHttp: boolean;
    localTranscription: boolean;
    backgroundNotifications: boolean;
    globalHotkey: boolean;
  };
}

export interface Transcriber {
  available(): Promise<boolean>;
  transcribe(audio: Uint8Array, mime: string, lang?: 'en' | 'fa'): Promise<string>;
}

export interface Platform {
  info: PlatformInfo;
  openDatabase(name: string): Promise<SqlDriver>;
  http: HttpClient;
  secrets: SecretStore;
  notifications: Notifier;
  files: FileService;
  audio: AudioRecorder;
  lifecycle: Lifecycle;
  /** Open a URL in the system browser (validated: https only). */
  openExternal(url: string): Promise<void>;
  /** Local speech-to-text (whisper.cpp sidecar on desktop), if any. */
  transcriber?: Transcriber;
  /** Apply the resolved theme to native chrome (window theme, status bar). */
  setNativeTheme?(theme: 'light' | 'dark'): Promise<void>;
}
