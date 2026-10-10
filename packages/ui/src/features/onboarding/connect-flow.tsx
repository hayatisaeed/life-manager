// Connect a repository: create a new one (passphrase + recovery key) or join
// an existing one (passphrase or recovery key). SYNC.md §8. Used by
// onboarding and Settings → Sync.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Copy } from 'lucide-react';
import { CryptoError, KDF_DESKTOP, KDF_MOBILE, fromB64 } from '@lm/crypto';
import type { LmJson } from '@lm/crypto';
import { NotFoundRepoError, SyncAuthError, initializeRepo, inspectRepo, unlockRepo } from '@lm/sync';
import { instantFromMs } from '@lm/core';
import { useServices } from '../../app/context';
import { DATA_KEY_SECRET } from '../../app/services';
import type { ForgeConfig } from '../../app/sync-controller';
import { makeTransport } from '../../app/sync-controller';
import { Button } from '../../components/button';
import { Checkbox, Field, Input, Segmented } from '../../components/form';
import { ProgressBar } from '../../components/display';

type Mode = 'new' | 'join';
type Step = 'forge' | 'passphrase' | 'recovery' | 'unlock' | 'syncing' | 'done';

const TOKEN_URLS = {
  github: 'https://github.com/settings/personal-access-tokens/new',
  gitlab: 'https://gitlab.com/-/user_settings/personal_access_tokens',
};

function useStrength(pass: string): number {
  const [score, setScore] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!pass) {
      setScore(0);
      return;
    }
    void (async () => {
      const [{ zxcvbn, zxcvbnOptions }, common, enLang] = await Promise.all([
        import('@zxcvbn-ts/core'),
        import('@zxcvbn-ts/language-common'),
        import('@zxcvbn-ts/language-en'),
      ]);
      zxcvbnOptions.setOptions({
        dictionary: { ...common.dictionary, ...enLang.dictionary },
        graphs: common.adjacencyGraphs,
      });
      const r = zxcvbn(pass);
      if (alive) setScore(r.score);
    })();
    return () => {
      alive = false;
    };
  }, [pass]);
  return score;
}

export function ConnectFlow({ mode, onDone, onCancel }: { mode: Mode; onDone: () => void; onCancel?: () => void }) {
  const { t } = useTranslation();
  const services = useServices();
  const [step, setStep] = useState<Step>('forge');
  const [cfg, setCfg] = useState<ForgeConfig>({ kind: 'github', host: 'github.com', repo: '' });
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [head, setHead] = useState<string | null>(null);
  const [header, setHeader] = useState<LmJson | null>(null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [recovery, setRecovery] = useState('');
  const [saved, setSaved] = useState(false);
  const [unlockWith, setUnlockWith] = useState<'passphrase' | 'recovery'>('passphrase');
  const [secret, setSecret] = useState('');
  const progress = services.sync.ui((s) => s.progress);
  const score = useStrength(pass);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const tr = makeTransport(services, cfg, token.trim());
      const access = await tr.checkAccess();
      if (!access.canWrite) throw new Error(t('onboarding.errNoWrite'));
      const r = await inspectRepo(tr);
      if (r.kind === 'public') throw new Error(t('onboarding.errPublic'));
      if (r.kind === 'foreign') throw new Error(t('onboarding.errForeign'));
      if (mode === 'new' && r.kind === 'initialized') throw new Error(t('onboarding.errNotEmpty'));
      if (mode === 'join' && r.kind === 'empty') throw new Error(t('onboarding.errEmpty'));
      if (r.kind === 'initialized') {
        setHeader(r.header);
        setStep('unlock');
      } else if (r.kind === 'empty') {
        setHead(r.head);
        setStep('passphrase');
      }
    } catch (e) {
      if (e instanceof SyncAuthError) setError(t('onboarding.errAuth'));
      else if (e instanceof NotFoundRepoError) setError(t('onboarding.errNotFound'));
      else setError(e instanceof Error ? e.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const firstSync = async () => {
    setStep('syncing');
    await services.sync.connect(cfg, token.trim());
    await services.sync.syncNow();
    setStep('done');
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    // Let the button paint its busy state before Argon2 blocks the thread.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const tr = makeTransport(services, cfg, token.trim());
      const cost = services.platform.info.kind === 'tauri' ? KDF_DESKTOP : KDF_MOBILE;
      const current = await services.platform.secrets.get(DATA_KEY_SECRET);
      const vault = await initializeRepo(
        tr,
        head,
        pass,
        cost,
        instantFromMs(services.env.now()).slice(0, 10),
        current ? fromB64(current) : undefined,
      );
      setRecovery(vault.recoveryKey);
      setStep('recovery');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    if (!header) return;
    setBusy(true);
    setError(null);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const dataKey = unlockRepo(header, unlockWith === 'passphrase' ? { passphrase: secret } : { recoveryKey: secret });
      await services.setDataKey(dataKey);
      await firstSync();
    } catch (e) {
      setError(e instanceof CryptoError ? t('onboarding.wrongSecret') : e instanceof Error ? e.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'forge') {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-title font-semibold">{t('onboarding.forgeTitle')}</h2>
        <Segmented
          label={t('onboarding.forge')}
          value={cfg.kind}
          onChange={(k) => setCfg({ ...cfg, kind: k, host: k === 'github' ? 'github.com' : 'gitlab.com' })}
          options={[
            { value: 'github', label: 'GitHub' },
            { value: 'gitlab', label: 'GitLab' },
          ]}
        />
        <p className="text-fg-muted">{cfg.kind === 'github' ? t('onboarding.guideGithub') : t('onboarding.guideGitlab')}</p>
        <div>
          <Button size="sm" variant="ghost" icon={<ExternalLink className="size-4" />} onClick={() => void services.platform.openExternal(TOKEN_URLS[cfg.kind])}>
            {t('onboarding.openGuide')}
          </Button>
        </div>
        <Field label={t('onboarding.host')} hint={t('onboarding.hostHint')}>
          {(id, d) => <Input id={id} aria-describedby={d} value={cfg.host} onChange={(e) => setCfg({ ...cfg, host: e.target.value })} autoCapitalize="off" spellCheck={false} />}
        </Field>
        <Field label={t('onboarding.repo')} hint={cfg.kind === 'github' ? t('onboarding.repoHintGithub') : t('onboarding.repoHintGitlab')}>
          {(id, d) => <Input id={id} aria-describedby={d} value={cfg.repo} onChange={(e) => setCfg({ ...cfg, repo: e.target.value.trim() })} autoCapitalize="off" spellCheck={false} placeholder="owner/name" />}
        </Field>
        <Field label={t('onboarding.token')} hint={t('onboarding.tokenHint')} error={error ?? undefined}>
          {(id, d) => <Input id={id} aria-describedby={d} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />}
        </Field>
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              {t('action.back')}
            </Button>
          )}
          <Button variant="primary" disabled={busy || !cfg.repo.includes('/') || !token.trim()} onClick={() => void check()}>
            {busy ? t('onboarding.checking') : t('onboarding.check')}
          </Button>
        </div>
      </div>
    );
  }

  if (step === 'passphrase') {
    const weak = score < 3;
    const mismatch = pass2.length > 0 && pass !== pass2;
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-title font-semibold">{t('onboarding.passTitle')}</h2>
        <p className="text-fg-muted">{t('onboarding.passBody')}</p>
        <Field label={t('onboarding.passphrase')} hint={pass ? t('onboarding.strength', { label: t(`onboarding.strengthLabels.${score}`) }) : undefined}>
          {(id, d) => <Input id={id} aria-describedby={d} type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />}
        </Field>
        <ProgressBar value={pass ? (score + 1) / 5 : 0} label={t('onboarding.passphrase')} />
        <Field label={t('onboarding.confirm')} error={mismatch ? t('onboarding.mismatch') : error ?? undefined}>
          {(id, d) => <Input id={id} aria-describedby={d} type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />}
        </Field>
        {pass && weak && <p className="text-small text-warning">{t('onboarding.tooWeak')}</p>}
        <div className="flex justify-end">
          <Button variant="primary" disabled={busy || weak || pass !== pass2} onClick={() => void create()}>
            {busy ? t('onboarding.creating') : t('onboarding.create')}
          </Button>
        </div>
      </div>
    );
  }

  if (step === 'recovery') {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-title font-semibold">{t('onboarding.recoveryTitle')}</h2>
        <p className="text-fg-muted">{t('onboarding.recoveryBody')}</p>
        <code dir="ltr" className="rounded-lg border border-line bg-subtle p-4 text-center font-mono text-heading tracking-wider break-all select-all" data-testid="recovery-key">
          {recovery}
        </code>
        <div>
          <Button size="sm" variant="ghost" icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard?.writeText(recovery)}>
            {t('action.copy')}
          </Button>
        </div>
        <label className="flex items-center gap-3">
          <Checkbox checked={saved} onCheckedChange={setSaved} label={t('onboarding.savedIt')} />
          <span>{t('onboarding.savedIt')}</span>
        </label>
        <div className="flex justify-end">
          <Button variant="primary" disabled={!saved} onClick={() => void firstSync()}>
            {t('onboarding.continue')}
          </Button>
        </div>
      </div>
    );
  }

  if (step === 'unlock') {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-title font-semibold">{t('onboarding.unlockTitle')}</h2>
        <Segmented
          label={t('onboarding.unlockTitle')}
          value={unlockWith}
          onChange={(v) => {
            setUnlockWith(v);
            setSecret('');
          }}
          options={[
            { value: 'passphrase', label: t('onboarding.usePassphrase') },
            { value: 'recovery', label: t('onboarding.useRecovery') },
          ]}
        />
        <Field label={unlockWith === 'passphrase' ? t('onboarding.passphrase') : t('onboarding.recoveryKey')} error={error ?? undefined}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              type={unlockWith === 'passphrase' ? 'password' : 'text'}
              value={secret}
              dir="ltr"
              onChange={(e) => setSecret(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && secret) void unlock();
              }}
            />
          )}
        </Field>
        <div className="flex justify-end">
          <Button variant="primary" disabled={busy || !secret} onClick={() => void unlock()}>
            {busy ? t('onboarding.unlocking') : t('onboarding.unlock')}
          </Button>
        </div>
      </div>
    );
  }

  if (step === 'syncing') {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-title font-semibold">{t('onboarding.syncingTitle')}</h2>
        <ProgressBar value={progress && progress.total ? progress.done / progress.total : 0.1} label={t('onboarding.syncingTitle')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-title font-semibold">{t('onboarding.doneTitle')}</h2>
      <p className="text-fg-muted">{t('onboarding.doneBody')}</p>
      <div className="flex justify-end">
        <Button variant="primary" onClick={onDone}>
          {t('onboarding.start')}
        </Button>
      </div>
    </div>
  );
}
