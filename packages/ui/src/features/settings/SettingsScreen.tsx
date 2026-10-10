import { formatLocalDate, todayIn, type Language } from '@lm/i18n';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/context';
import type { AppSettings } from '../../app/settings';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Select } from '../../components/Select';
import { SyncPill } from '../../layout/SyncPill';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-body text-text">{label}</span>
      {children}
    </div>
  );
}

/**
 * Account settings that sync (DATA-MODEL.md §14). Language, calendar and
 * digits are independent (ADR-008); the example date shows their effect.
 */
export function SettingsScreen() {
  const { t } = useTranslation();
  const { settings, settingsStore, locale, clock, timeZone, syncStatus } = useApp();
  // The UI changes at once; aria-busy tells assistive tech (and tests) a save is pending.
  const [saving, setSaving] = useState(0);
  const set = (patch: Partial<AppSettings>) => {
    setSaving((n) => n + 1);
    settingsStore
      .update(patch)
      .catch((error: unknown) => console.error('saving settings failed', error))
      .finally(() => setSaving((n) => n - 1));
  };
  return (
    <section className="flex flex-col gap-10" aria-busy={saving > 0} data-testid="settings">
      <h1 className="text-display font-semibold">{t('settings.title')}</h1>

      <div className="flex flex-col">
        <h2 className="text-heading font-semibold">{t('settings.general')}</h2>
        <div className="divide-y divide-border">
          <Row label={t('settings.language')}>
            <Select<Language>
              label={t('settings.language')}
              value={settings.language}
              options={[
                { value: 'en', label: t('settings.languages.en') },
                { value: 'fa', label: t('settings.languages.fa') },
              ]}
              onValueChange={(language) => set({ language })}
            />
          </Row>
          <Row label={t('settings.calendar')}>
            <SegmentedControl
              label={t('settings.calendar')}
              value={settings.calendar}
              options={[
                { value: 'gregorian', label: t('settings.calendars.gregorian') },
                { value: 'jalali', label: t('settings.calendars.jalali') },
              ]}
              onValueChange={(calendar) => set({ calendar })}
            />
          </Row>
          <Row label={t('settings.weekStart')}>
            <Select<'0' | '1' | '6'>
              label={t('settings.weekStart')}
              value={String(settings.weekStart) as '0' | '1' | '6'}
              options={[
                { value: '6', label: t('settings.weekdays.6') },
                { value: '0', label: t('settings.weekdays.0') },
                { value: '1', label: t('settings.weekdays.1') },
              ]}
              onValueChange={(day) => set({ weekStart: Number(day) })}
            />
          </Row>
          <Row label={t('settings.digits')}>
            <SegmentedControl
              label={t('settings.digits')}
              value={settings.digits}
              options={[
                { value: 'latin', label: t('settings.digitOptions.latin') },
                { value: 'native', label: t('settings.digitOptions.native') },
              ]}
              onValueChange={(digits) => set({ digits })}
            />
          </Row>
          <Row label={t('settings.theme')}>
            <SegmentedControl
              label={t('settings.theme')}
              value={settings.theme}
              options={[
                { value: 'system', label: t('settings.themes.system') },
                { value: 'light', label: t('settings.themes.light') },
                { value: 'dark', label: t('settings.themes.dark') },
              ]}
              onValueChange={(theme) => set({ theme })}
            />
          </Row>
        </div>
        <p className="pt-2 text-small text-text-muted" data-testid="date-example">
          {t('settings.example', {
            date: formatLocalDate(todayIn(clock(), timeZone), locale, 'full'),
          })}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-heading font-semibold">{t('settings.sync')}</h2>
        <div>
          <SyncPill status={syncStatus} />
        </div>
        <p className="max-w-prose text-body text-text-muted">{t('settings.syncNotSetUp')}</p>
      </div>
    </section>
  );
}
