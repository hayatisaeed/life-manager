// App-wide strings: navigation, sync status and shared words.
export const appEn = {
  appName: 'Life Manager',
  nav: { main: 'Main', today: 'Today', settings: 'Settings' },
  sync: {
    local: 'On this device only',
    synced: 'Synced',
    syncing: 'Syncing…',
    offline: 'Offline',
    error: 'Sync problem',
  },
  boot: {
    loading: 'Opening your data…',
    otherTab: 'Life Manager is open in another tab.',
    otherTabHint: 'Only one tab can use your data at a time.',
    useHere: 'Use it here',
    failed: 'Your data could not be opened.',
  },
};

export const appFa: typeof appEn = {
  appName: 'مدیر زندگی',
  nav: { main: 'اصلی', today: 'امروز', settings: 'تنظیمات' },
  sync: {
    local: 'فقط روی همین دستگاه',
    synced: 'همگام شد',
    syncing: 'در حال همگام‌سازی…',
    offline: 'آفلاین',
    error: 'مشکل همگام‌سازی',
  },
  boot: {
    loading: 'در حال باز کردن داده‌های شما…',
    otherTab: 'مدیر زندگی در زبانه‌ی دیگری باز است.',
    otherTabHint: 'هر بار فقط یک زبانه می‌تواند از داده‌های شما استفاده کند.',
    useHere: 'استفاده در این‌جا',
    failed: 'داده‌های شما باز نشد.',
  },
};
