import { formatLocalDate, todayIn } from '@lm/i18n';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/context';
import { EmptyState } from '../../components/EmptyState';

function partOfDay(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

/** Home screen (DESIGN.md §5). Agenda, tasks and habits join in Phase 1. */
export function TodayScreen() {
  const { t } = useTranslation();
  const { clock, timeZone, locale } = useApp();
  const now = clock();
  const hour = Number(
    new Intl.DateTimeFormat('en-u-nu-latn', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(
      now,
    ),
  );
  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-display font-semibold">{t(`today.greeting.${partOfDay(hour)}`)}</h1>
        <p className="text-body text-text-muted">
          {formatLocalDate(todayIn(now, timeZone), locale, 'full')}
        </p>
      </header>
      <EmptyState title={t('today.emptyTitle')} body={t('today.emptyBody')} />
    </section>
  );
}
