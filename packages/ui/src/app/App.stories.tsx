import type { Story } from '@ladle/react';
import { App } from './App';
export const EnglishLight: Story = () => (
  <App
    initialPreferences={{ language: 'en', calendar: 'gregorian', digits: 'latin', theme: 'light' }}
  />
);
export const EnglishDark: Story = () => (
  <App
    initialPreferences={{ language: 'en', calendar: 'gregorian', digits: 'latin', theme: 'dark' }}
  />
);
export const PersianLight: Story = () => (
  <App
    initialPreferences={{ language: 'fa', calendar: 'jalali', digits: 'persian', theme: 'light' }}
  />
);
export const PersianDark: Story = () => (
  <App
    initialPreferences={{ language: 'fa', calendar: 'jalali', digits: 'persian', theme: 'dark' }}
  />
);
