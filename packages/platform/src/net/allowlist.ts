// The only kinds of remote endpoints the app may call (SECURITY.md §6). Hosts
// are user-configured, so this validates *shape* (https, no credentials in the
// URL) and records which feature a request belongs to. The Tauri capability
// config mirrors these categories.

export type EndpointKind = 'forge' | 'ai' | 'calendar' | 'fx' | 'update' | 'transcription';

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** True when `url` may be requested for `kind`. Plain http is only allowed to local/LAN AI and STT hosts (Ollama, whisper). */
export function isAllowedUrl(url: string, kind: EndpointKind): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:' && (kind === 'ai' || kind === 'transcription')) {
    return (
      LOCAL_HOSTS.test(u.hostname) || PRIVATE_V4.test(u.hostname) || u.hostname.endsWith('.local')
    );
  }
  return false;
}

export class BlockedUrlError extends Error {
  constructor(kind: EndpointKind) {
    super(`Blocked request (${kind}): only https endpoints are allowed`);
    this.name = 'BlockedUrlError';
  }
}
