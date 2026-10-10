// Applies theme (system/light/dark) and language direction to <html> (DESIGN.md §4, §8).

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isRtl } from '@lm/i18n';
import { useSettings } from '../hooks/settings';
import { useServices } from './context';

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark;
}

export function useResolvedTheme(): 'light' | 'dark' {
  const [s] = useSettings();
  const sys = useSystemDark();
  return s.theme === 'system' ? (sys ? 'dark' : 'light') : s.theme;
}

export function DocumentSettings() {
  const [s] = useSettings();
  const theme = useResolvedTheme();
  const { i18n } = useTranslation();
  const { platform } = useServices();
  useEffect(() => {
    const html = document.documentElement;
    html.dataset['theme'] = theme;
    void platform.setNativeTheme?.(theme);
  }, [theme, platform]);
  useEffect(() => {
    const html = document.documentElement;
    html.lang = s.language;
    html.dir = isRtl(s.language) ? 'rtl' : 'ltr';
    if (i18n.language !== s.language) void i18n.changeLanguage(s.language);
  }, [s.language, i18n]);
  return null;
}
