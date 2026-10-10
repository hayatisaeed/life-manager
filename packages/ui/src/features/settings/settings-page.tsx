import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { Bell, Bot, CalendarRange, ChevronRight, Database, Info, RefreshCw, Shield } from 'lucide-react';
import { isValidTimeZone, weekdayNames } from '@lm/i18n';
import { Page } from '../../app/layout';
import { Input, Segmented, Select, Switch } from '../../components/form';
import { useLocale, useSettings } from '../../hooks/settings';
import { CURRENCIES } from '../../lib/currencies';
import { cn } from '../../lib/cn';

export function Row({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-line py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="font-medium">{label}</div>
        {hint && <div className="text-small text-fg-muted">{hint}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function SettingsGroup({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-1 text-small font-semibold tracking-wide text-fg-muted uppercase">{title}</h2>
      <div className="rounded-lg border border-line px-4">{children}</div>
    </section>
  );
}

const SECTIONS = [
  { to: '/settings/sync', key: 'sync', icon: RefreshCw },
  { to: '/settings/notifications', key: 'notifications', icon: Bell },
  { to: '/settings/ai', key: 'ai', icon: Bot },
  { to: '/settings/calendars', key: 'calendars', icon: CalendarRange },
  { to: '/settings/data', key: 'data', icon: Database },
  { to: '/settings/security', key: 'security', icon: Shield },
  { to: '/settings/about', key: 'about', icon: Info },
] as const;

export function SettingsPage() {
  const { t } = useTranslation();
  const [s, update] = useSettings();
  const loc = useLocale();
  return (
    <Page title={t('settings.title')}>
      <nav className="mb-6 grid gap-2 sm:grid-cols-2">
        {SECTIONS.map(({ to, key, icon: Icon }) => (
          <Link key={to} to={to} className="flex h-12 items-center gap-3 rounded-lg border border-line px-4 hover:bg-subtle">
            <Icon className="size-4 text-fg-muted" />
            <span className="flex-1">{t(`settings.sections.${key}`)}</span>
            <ChevronRight className="size-4 text-fg-muted rtl-flip" />
          </Link>
        ))}
      </nav>
      <SettingsGroup title={t('settings.appearance')}>
        <Row label={t('settings.theme')}>
          <Segmented
            label={t('settings.theme')}
            value={s.theme}
            onChange={(theme) => void update({ theme })}
            options={[
              { value: 'system', label: t('theme.system') },
              { value: 'light', label: t('theme.light') },
              { value: 'dark', label: t('theme.dark') },
            ]}
          />
        </Row>
        <Row label={t('settings.language')}>
          <Segmented
            label={t('settings.language')}
            value={s.language}
            onChange={(language) => void update({ language })}
            options={[
              { value: 'en', label: t('language.en') },
              { value: 'fa', label: t('language.fa') },
            ]}
          />
        </Row>
      </SettingsGroup>
      <SettingsGroup title={t('settings.region')}>
        <Row label={t('settings.calendar')}>
          <Segmented
            label={t('settings.calendar')}
            value={s.calendar}
            onChange={(calendar) => void update({ calendar })}
            options={[
              { value: 'gregorian', label: t('calendar.gregorian') },
              { value: 'jalali', label: t('calendar.jalali') },
            ]}
          />
        </Row>
        <Row label={t('settings.weekStart')}>
          <Select
            aria-label={t('settings.weekStart')}
            className="w-44"
            value={String(s.weekStart)}
            onChange={(e) => void update({ weekStart: Number(e.target.value) })}
            options={weekdayNames({ ...loc, weekStart: 0 }, 'long').map((w) => ({ value: String(w.day), label: w.name }))}
          />
        </Row>
        <Row label={t('settings.digits')}>
          <Segmented
            label={t('settings.digits')}
            value={s.digits}
            onChange={(digits) => void update({ digits })}
            options={[
              { value: 'latin', label: t('digits.latin') },
              { value: 'persian', label: t('digits.persian') },
            ]}
          />
        </Row>
        <Row label={t('settings.timeZone')}>
          <Input
            aria-label={t('settings.timeZone')}
            className={cn('w-56', !isValidTimeZone(s.timeZone) && 'border-danger')}
            defaultValue={s.timeZone}
            dir="ltr"
            onBlur={(e) => {
              if (isValidTimeZone(e.target.value)) void update({ timeZone: e.target.value });
            }}
          />
        </Row>
        <Row label={t('settings.baseCurrency')}>
          <Select
            aria-label={t('settings.baseCurrency')}
            className="w-32"
            value={s.baseCurrency}
            onChange={(e) => void update({ baseCurrency: e.target.value })}
            options={CURRENCIES.map((c) => ({ value: c, label: c }))}
          />
        </Row>
        <Row label={t('settings.toman')}>
          <Switch label={t('settings.toman')} checked={s.tomanDisplay} onCheckedChange={(tomanDisplay) => void update({ tomanDisplay })} />
        </Row>
      </SettingsGroup>
      <SettingsGroup title={t('settings.workingHours')}>
        <Row label={t('settings.workingHours')}>
          <Input
            type="time"
            aria-label={t('common.start')}
            className="w-28"
            value={s.workingHours.start}
            onChange={(e) => void update({ workingHours: { ...s.workingHours, start: e.target.value } })}
          />
          <span aria-hidden>–</span>
          <Input
            type="time"
            aria-label={t('common.end')}
            className="w-28"
            value={s.workingHours.end}
            onChange={(e) => void update({ workingHours: { ...s.workingHours, end: e.target.value } })}
          />
        </Row>
        <Row label={t('settings.workingDays')}>
          <div className="flex flex-wrap gap-1">
            {weekdayNames(loc, 'short').map((w) => {
              const on = s.workingHours.days.includes(w.day);
              return (
                <button
                  key={w.day}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    void update({
                      workingHours: {
                        ...s.workingHours,
                        days: on ? s.workingHours.days.filter((d) => d !== w.day) : [...s.workingHours.days, w.day].sort(),
                      },
                    })
                  }
                  className={cn('h-8 min-w-10 rounded-md px-2 text-small', on ? 'bg-accent text-on-accent' : 'bg-muted text-fg-muted')}
                >
                  {w.name}
                </button>
              );
            })}
          </div>
        </Row>
        <Row label={t('settings.energy')}>
          <Segmented
            label={t('settings.energy')}
            value={s.energyProfile}
            onChange={(energyProfile) => void update({ energyProfile })}
            options={[
              { value: 'morning', label: t('settings.energyMorning') },
              { value: 'afternoon', label: t('settings.energyAfternoon') },
              { value: 'evening', label: t('settings.energyEvening') },
            ]}
          />
        </Row>
      </SettingsGroup>
    </Page>
  );
}
