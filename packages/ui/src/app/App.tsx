// Root component shared by web, desktop and mobile: boots services on the
// given platform, then shows onboarding or the app.

import { useEffect, useMemo, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { RouterProvider } from '@tanstack/react-router';
import type { I18n } from '@lm/i18n';
import type { Platform } from '@lm/platform';
import type { Env } from '@lm/core';
import '../theme/app.css';
import { ServicesContext } from './context';
import type { Services } from './services';
import { bootServices } from './services';
import { setupI18n } from './i18n-setup';
import { buildRouter } from './routes';
import { DocumentSettings } from './theme';
import { readSettings } from '../hooks/settings';
import { useDevice } from '../hooks/live';
import { OnboardingPage, ONBOARDED_KEY } from '../features/onboarding/onboarding-page';
import { Toaster, toast } from '../components/toast';

function Shell({ memoryRouter }: { memoryRouter: boolean }) {
  const onboarded = useDevice<boolean>(ONBOARDED_KEY);
  const router = useMemo(() => buildRouter({ memory: memoryRouter }), [memoryRouter]);
  const services = useServicesOrThrow();
  const { t } = useTranslation();
  useEffect(() => {
    services.sync.onEvent = (e) =>
      toast(e.kind === 'restored' ? t('sync.restoredToast', { count: e.count }) : t('sync.conflictToast', { count: e.count }));
    return services.sync.start();
  }, [services, t]);
  if (onboarded === undefined) return null;
  if (!onboarded) {
    return (
      <>
        <OnboardingPage onFinished={() => undefined} />
        <Toaster />
      </>
    );
  }
  return <RouterProvider router={router} />;
}

let current: Services | null = null;
function useServicesOrThrow(): Services {
  if (!current) throw new Error('services not booted');
  return current;
}

export interface AppProps {
  platform: Platform;
  env?: Env;
  dbName?: string;
  /** Use in-memory routing (tests, stories). */
  memoryRouter?: boolean;
}

export function App({ platform, env, dbName, memoryRouter = false }: AppProps) {
  const [state, setState] = useState<{ services: Services; i18n: I18n } | { error: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const services = await bootServices(platform, env, dbName);
        const settings = await readSettings(services.store);
        const i18n = await setupI18n(settings.language);
        current = services;
        if (alive) setState({ services, i18n });
      } catch (e) {
        console.error('boot failed', e);
        if (alive) setState({ error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [platform, env, dbName]);
  if (!state) return <div className="flex h-full items-center justify-center text-fg-muted" aria-busy="true" />;
  if ('error' in state) {
    return (
      <div role="alert" className="p-8">
        <h1 className="text-title font-semibold">Life Manager</h1>
        <p className="mt-2 text-danger">{state.error}</p>
      </div>
    );
  }
  return (
    <ServicesContext.Provider value={state.services}>
      <I18nextProvider i18n={state.i18n}>
        <DocumentSettings />
        <Shell memoryRouter={memoryRouter} />
      </I18nextProvider>
    </ServicesContext.Provider>
  );
}
