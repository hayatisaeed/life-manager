import type { GlobalProvider } from '@ladle/react';
import { createI18n } from '@lm/i18n';
import type { i18n as I18n } from 'i18next';
import { useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { resources } from '../src/app/resources';
import '../src/theme/app.css';

// Every story renders with the real tokens, in the theme and direction picked
// in Ladle's toolbar (DESIGN.md §6). RTL also switches the strings to Persian.
export const Provider: GlobalProvider = ({ children, globalState }) => {
  const language = globalState.rtl ? 'fa' : 'en';
  const [i18n, setI18n] = useState<I18n | null>(null);
  useEffect(() => {
    void createI18n(language, resources).then(setI18n);
  }, [language]);
  useEffect(() => {
    const html = document.documentElement;
    html.dataset['theme'] = globalState.theme === 'dark' ? 'dark' : 'light';
    html.lang = language;
    html.dir = globalState.rtl ? 'rtl' : 'ltr';
  }, [globalState.theme, globalState.rtl, language]);
  if (!i18n) return null;
  return (
    <I18nextProvider i18n={i18n}>
      <div className="min-h-dvh bg-bg p-6 text-text">{children}</div>
    </I18nextProvider>
  );
};
