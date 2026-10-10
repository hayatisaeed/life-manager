import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, HardDrive, Link2 } from 'lucide-react';
import { useServices } from '../../app/context';
import { Button } from '../../components/button';
import { Field, Segmented, Select } from '../../components/form';
import { useSettings } from '../../hooks/settings';
import { CURRENCIES } from '../../lib/currencies';
import { ConnectFlow } from './connect-flow';

export const ONBOARDED_KEY = 'onboarded';

export function OnboardingPage({ onFinished }: { onFinished: () => void }) {
  const { t } = useTranslation();
  const { store } = useServices();
  const [settings, update] = useSettings();
  const [step, setStep] = useState<'welcome' | 'mode' | 'new' | 'join'>('welcome');

  const finish = async () => {
    await update({ ...settings });
    await store.setDevice(ONBOARDED_KEY, true);
    onFinished();
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-subtle p-4 safe-top">
      <div className="w-full max-w-lg rounded-lg border border-line bg-bg p-6 shadow-soft sm:p-8">
        {step === 'welcome' && (
          <div className="flex flex-col gap-5">
            <div>
              <h1 className="text-display font-semibold">{t('onboarding.welcome')}</h1>
              <p className="mt-2 text-fg-muted">{t('onboarding.welcomeBody')}</p>
            </div>
            <Field label={t('onboarding.language')}>
              {() => (
                <Segmented
                  label={t('onboarding.language')}
                  value={settings.language}
                  onChange={(language) =>
                    void update(
                      language === 'fa'
                        ? { language, calendar: 'jalali', digits: 'persian', weekStart: 6 }
                        : { language, calendar: 'gregorian', digits: 'latin', weekStart: 1 },
                    )
                  }
                  options={[
                    { value: 'en', label: t('language.en') },
                    { value: 'fa', label: t('language.fa') },
                  ]}
                />
              )}
            </Field>
            <Field label={t('onboarding.calendar')}>
              {() => (
                <Segmented
                  label={t('onboarding.calendar')}
                  value={settings.calendar}
                  onChange={(calendar) => void update({ calendar, weekStart: calendar === 'jalali' ? 6 : 1 })}
                  options={[
                    { value: 'gregorian', label: t('calendar.gregorian') },
                    { value: 'jalali', label: t('calendar.jalali') },
                  ]}
                />
              )}
            </Field>
            <Field label={t('onboarding.currency')}>
              {(id) => (
                <Select
                  id={id}
                  value={settings.baseCurrency}
                  onChange={(e) => void update({ baseCurrency: e.target.value, tomanDisplay: e.target.value === 'IRR' })}
                  options={CURRENCIES.map((c) => ({ value: c, label: c }))}
                />
              )}
            </Field>
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setStep('mode')}>
                {t('onboarding.continue')}
              </Button>
            </div>
          </div>
        )}
        {step === 'mode' && (
          <div className="flex flex-col gap-3">
            <h1 className="mb-2 text-title font-semibold">{t('onboarding.howTitle')}</h1>
            {(
              [
                ['local', HardDrive, 'localTitle', 'localBody'],
                ['new', Cloud, 'newTitle', 'newBody'],
                ['join', Link2, 'joinTitle', 'joinBody'],
              ] as const
            ).map(([m, Icon, title, body]) => (
              <button
                key={m}
                type="button"
                onClick={() => (m === 'local' ? void finish() : setStep(m))}
                className="flex items-start gap-4 rounded-lg border border-line p-4 text-start transition-colors hover:border-accent hover:bg-subtle"
              >
                <Icon className="mt-0.5 size-5 shrink-0 text-accent" />
                <span>
                  <span className="block font-semibold">{t(`onboarding.${title}`)}</span>
                  <span className="mt-0.5 block text-fg-muted">{t(`onboarding.${body}`)}</span>
                </span>
              </button>
            ))}
            <div>
              <Button variant="ghost" onClick={() => setStep('welcome')}>
                {t('action.back')}
              </Button>
            </div>
          </div>
        )}
        {(step === 'new' || step === 'join') && (
          <ConnectFlow mode={step} onDone={() => void finish()} onCancel={() => setStep('mode')} />
        )}
      </div>
    </div>
  );
}
