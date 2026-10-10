import type { Rng } from '@lm/core';
import { LmDatabase, type SqlDriver } from '@lm/db';
import { createI18n, directionOf, preferredLanguage } from '@lm/i18n';
import type { Ownership } from '@lm/platform';
import type { i18n as I18n } from 'i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApplyTheme } from '../theme/theme';
import { App } from './App';
import { BootScreen } from './BootScreen';
import { resources } from './resources';
import { createDbSettingsStore, defaultSettings, type SettingsStore } from './settings';

/** What a platform shell supplies to start the app (ARCHITECTURE.md §2). */
export interface BootPlatform {
  /** Claims the database for this tab or window (ADR-011); null if another holds it. */
  claim(options: { steal: boolean }): Promise<Ownership | null>;
  /** Opens the database. `dispose` frees it even if the driver is stuck (e.g. kills the worker). */
  openDriver(): Promise<{ driver: SqlDriver; dispose(): void }>;
  clock: () => number;
  rng: Rng;
  languages: readonly string[];
  /** Waits between open attempts; injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

type State =
  | { phase: 'loading' }
  | { phase: 'otherTab' }
  | { phase: 'failed'; message: string }
  | { phase: 'ready'; db: LmDatabase; settingsStore: SettingsStore };

/**
 * After another tab gives the database up, its worker can hold the OPFS files
 * for a moment, so opening is retried a few times before failing.
 */
const OPEN_ATTEMPTS = 8;

export function Boot({ platform }: { platform: BootPlatform }) {
  const [i18n, setI18n] = useState<I18n | null>(null);
  const language = preferredLanguage(platform.languages);
  const [state, setState] = useState<State>({ phase: 'loading' });
  const disposeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    void createI18n(language, resources).then(setI18n);
  }, [language]);

  /** Claims ownership and opens the database; resolves to the state to show. */
  const open = useCallback(
    async (steal: boolean): Promise<{ next: State; ownership: Ownership | null }> => {
      const ownership = await platform.claim({ steal });
      if (!ownership) return { next: { phase: 'otherTab' }, ownership };
      const sleep = platform.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
      let lastError: unknown = null;
      for (let attempt = 0; attempt < OPEN_ATTEMPTS; attempt++) {
        try {
          const { driver, dispose } = await platform.openDriver();
          disposeRef.current = dispose;
          const db = await LmDatabase.open({
            driver,
            clock: platform.clock,
            rng: platform.rng,
            onProblem: (p) => console.warn('unreadable record kept', p.type, p.id, p.reason),
          });
          const settingsStore = await createDbSettingsStore(db, defaultSettings(language));
          return { next: { phase: 'ready', db, settingsStore }, ownership };
        } catch (error) {
          lastError = error;
          disposeRef.current?.();
          disposeRef.current = null;
          await sleep(250 * (attempt + 1));
        }
      }
      ownership.release();
      return {
        next: {
          phase: 'failed',
          message: lastError instanceof Error ? lastError.message : String(lastError),
        },
        ownership: null,
      };
    },
    [platform, language],
  );

  const run = useCallback(
    (steal: boolean) => {
      void open(steal).then(({ next, ownership }) => {
        setState(next);
        if (next.phase !== 'ready' || !ownership) return;
        void ownership.lost.then(() => {
          // Another tab took over: let go of the files so it can open them.
          disposeRef.current?.();
          disposeRef.current = null;
          setState({ phase: 'otherTab' });
        });
      });
    },
    [open],
  );

  useEffect(() => {
    run(false);
    return () => disposeRef.current?.();
  }, [run]);

  if (!i18n) return null;
  if (state.phase === 'ready')
    return <App i18n={i18n} settingsStore={state.settingsStore} clock={platform.clock} />;
  return (
    <BootStatus
      i18n={i18n}
      language={language}
      state={state}
      onUseHere={() => {
        setState({ phase: 'loading' });
        run(true);
      }}
    />
  );
}

/**
 * The screens before settings exist follow the OS theme and the browser
 * language, so a dark, Persian device never flashes light and left-to-right.
 */
function BootStatus({
  i18n,
  language,
  state,
  onUseHere,
}: {
  i18n: I18n;
  language: ReturnType<typeof preferredLanguage>;
  state: Exclude<State, { phase: 'ready' }>;
  onUseHere: () => void;
}) {
  useApplyTheme('system');
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = directionOf(language);
  }, [language]);
  const t = i18n.t.bind(i18n);
  switch (state.phase) {
    case 'loading':
      return <BootScreen title={t('boot.loading')} />;
    case 'otherTab':
      return (
        <BootScreen
          title={t('boot.otherTab')}
          body={t('boot.otherTabHint')}
          action={{ label: t('boot.useHere'), onClick: onUseHere }}
        />
      );
    case 'failed':
      return <BootScreen title={t('boot.failed')} body={state.message} />;
  }
}
