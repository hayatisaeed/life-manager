import type { Story } from '@ladle/react';
import { createMemoryHistory } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { App } from './App';
import { createMemorySettingsStore, defaultSettings } from './settings';

// The whole shell with in-memory settings. Ladle's RTL toggle switches the
// strings to Persian; the settings screen can then change everything live.
function Shell({ path }: { path: string }) {
  const { i18n } = useTranslation();
  const language = i18n.language === 'fa' ? 'fa' : 'en';
  return (
    <App
      key={language}
      i18n={i18n}
      settingsStore={createMemorySettingsStore(defaultSettings(language))}
      history={createMemoryHistory({ initialEntries: [path] })}
    />
  );
}

export const Today: Story = () => <Shell path="/" />;
export const Settings: Story = () => <Shell path="/settings" />;
