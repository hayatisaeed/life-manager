import { useTranslation } from 'react-i18next';
import { Page } from './layout';

export function Placeholder({ navKey }: { navKey: string }) {
  const { t } = useTranslation();
  return (
    <Page title={t(`nav.${navKey}`)}>
      <p className="text-fg-muted">…</p>
    </Page>
  );
}
