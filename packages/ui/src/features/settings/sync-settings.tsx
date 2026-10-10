import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@lm/i18n';
import { useServices } from '../../app/context';
import { Page } from '../../app/layout';
import { Button } from '../../components/button';
import { Dialog } from '../../components/overlay';
import { Input } from '../../components/form';
import { useLive } from '../../hooks/live';
import { useLocale } from '../../hooks/settings';
import { ConnectFlow } from '../onboarding/connect-flow';
import { Row, SettingsGroup } from './settings-page';

export function SyncSettingsPage() {
  const { t } = useTranslation();
  const { sync, syncState } = useServices();
  const st = sync.ui();
  const loc = useLocale();
  const problems = useLive(() => syncState.problems(), [st.lastSyncAt], null) ?? [];
  const [connect, setConnect] = useState<'new' | 'join' | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);

  if (!st.configured) {
    return (
      <Page title={t('settings.sync.title')}>
        {connect ? (
          <div className="rounded-lg border border-line p-5">
            <ConnectFlow mode={connect} onDone={() => setConnect(null)} onCancel={() => setConnect(null)} />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-fg-muted">{t('settings.sync.notConfigured')}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setConnect('new')}>
                {t('settings.sync.connectNew')}
              </Button>
              <Button onClick={() => setConnect('join')}>{t('settings.sync.connectJoin')}</Button>
            </div>
          </div>
        )}
      </Page>
    );
  }

  const phaseLabel = {
    idle: t('sync.synced'),
    syncing: t('sync.syncing'),
    offline: t('sync.offline'),
    error: t('sync.error'),
    paused: t('sync.paused'),
    rateLimited: t('sync.rateLimited'),
  }[st.phase];

  return (
    <Page
      title={t('settings.sync.title')}
      actions={
        <Button variant="primary" disabled={st.phase === 'syncing'} onClick={() => void sync.syncNow()}>
          {t('sync.syncNow')}
        </Button>
      }
    >
      <SettingsGroup title={t('settings.sync.status')}>
        <Row label={t('settings.sync.repository')}>
          <span dir="ltr" className="text-fg-muted">
            {st.config?.host}/{st.config?.repo}
          </span>
        </Row>
        <Row label={t('settings.sync.status')} hint={st.error ?? undefined}>
          <span>{phaseLabel}</span>
        </Row>
        <Row label={t('settings.sync.lastSync')}>
          <span className="text-fg-muted">{st.lastSyncAt ? formatDateTime(st.lastSyncAt, loc) : t('sync.never')}</span>
        </Row>
      </SettingsGroup>
      {st.newerSchema && <p className="mb-4 rounded-lg bg-warning-soft p-3 text-warning">{t('common.updateApp')}</p>}
      <SettingsGroup title={t('settings.sync.problems')}>
        {problems.length === 0 ? (
          <p className="py-3 text-fg-muted">{t('settings.sync.noProblems')}</p>
        ) : (
          <div className="py-3">
            <p className="mb-2 text-small text-fg-muted">{t('settings.sync.problemsBody')}</p>
            <ul className="mb-3 flex flex-col gap-1 font-mono text-small" dir="ltr">
              {problems.map((p) => (
                <li key={p.path} className="truncate">
                  {p.reason} · {p.path}
                </li>
              ))}
            </ul>
            <Button size="sm" onClick={() => void sync.retryProblems()}>
              {t('settings.sync.retry')}
            </Button>
          </div>
        )}
      </SettingsGroup>
      <SettingsGroup title={t('settings.general')}>
        <Row label={t('settings.sync.fullResync')} hint={t('settings.sync.fullResyncBody')}>
          <Button size="sm" onClick={() => void sync.fullResync()}>
            {t('settings.sync.fullResync')}
          </Button>
        </Row>
        <Row label={t('settings.sync.updateToken')}>
          <Button size="sm" onClick={() => setTokenOpen(true)}>
            {t('settings.sync.updateToken')}
          </Button>
        </Row>
        <Row label={t('settings.sync.disconnect')} hint={t('settings.sync.disconnectBody')}>
          <Button size="sm" variant="danger" onClick={() => setConfirmOff(true)}>
            {t('settings.sync.disconnect')}
          </Button>
        </Row>
      </SettingsGroup>
      <Dialog
        open={tokenOpen}
        onOpenChange={setTokenOpen}
        title={t('settings.sync.updateToken')}
        footer={
          <Button
            variant="primary"
            disabled={!token.trim()}
            onClick={() => {
              void sync.updateToken(token.trim()).then(() => sync.syncNow());
              setToken('');
              setTokenOpen(false);
            }}
          >
            {t('action.save')}
          </Button>
        }
      >
        <Input type="password" aria-label={t('settings.sync.newToken')} value={token} onChange={(e) => setToken(e.target.value)} />
      </Dialog>
      <Dialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title={t('settings.sync.disconnectConfirm')}
        description={t('settings.sync.disconnectBody')}
        footer={
          <>
            <Button onClick={() => setConfirmOff(false)}>{t('action.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                void sync.disconnect();
                setConfirmOff(false);
              }}
            >
              {t('settings.sync.disconnect')}
            </Button>
          </>
        }
      />
    </Page>
  );
}
