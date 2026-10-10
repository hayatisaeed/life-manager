import { Button } from '../components/Button';

/**
 * Shown before the app can run: while the database opens, when another tab
 * owns it (ADR-011), or when it fails. Strings are passed in because i18n may
 * not be ready yet.
 */
export function BootScreen({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg p-6 text-center text-text">
      <h1 className="text-title font-semibold">{title}</h1>
      {body !== undefined && <p className="max-w-sm text-body text-text-muted">{body}</p>}
      {action && (
        <Button variant="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </main>
  );
}
