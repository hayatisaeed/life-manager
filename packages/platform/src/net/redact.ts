// Log redaction (SECURITY.md §6). Logs never include tokens, keys or record contents.

const PATTERNS: [RegExp, string][] = [
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[github-token]'],
  [/\bglpat-[A-Za-z0-9_-]{16,}\b/g, '[gitlab-token]'],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}\b/g, '[anthropic-key]'],
  [/\b(Bearer|token|PRIVATE-TOKEN)[:=\s]+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 [redacted]'],
  [/\bLMR1\.[A-Za-z0-9_-]+/g, '[record]'],
  [
    /"(passphrase|password|token|apiKey|secret|dataKey|recoveryKey)"\s*:\s*"[^"]*"/gi,
    '"$1":"[redacted]"',
  ],
];

export function redact(input: unknown): string {
  let s: string;
  if (input instanceof Error) s = `${input.name}: ${input.message}`;
  else if (typeof input === 'string') s = input;
  else {
    try {
      s = JSON.stringify(input);
    } catch {
      s = String(input);
    }
  }
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  return s;
}

/** console.warn through redact(); the only logger the app uses. */
export const log = {
  warn: (...args: unknown[]) => console.warn(...args.map(redact)),
  error: (...args: unknown[]) => console.error(...args.map(redact)),
};
