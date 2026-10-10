import { useEffect, useState } from 'react';

export type ThemeSetting = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): ResolvedTheme {
  if (setting === 'system') return prefersDark ? 'dark' : 'light';
  return setting;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Sets `data-theme` on <html> from the setting, following the OS while the
 * setting is `system` (DESIGN.md §4). Returns the theme in effect.
 */
export function useApplyTheme(
  setting: ThemeSetting,
  root: HTMLElement = document.documentElement,
): ResolvedTheme {
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => setPrefersDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  const theme = resolveTheme(setting, prefersDark);
  useEffect(() => {
    root.dataset['theme'] = theme;
  }, [root, theme]);
  return theme;
}
