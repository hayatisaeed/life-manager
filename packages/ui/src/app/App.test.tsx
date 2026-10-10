import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { media } from '../test-support/setup';
import { renderApp } from '../test-support/render';

afterEach(() => {
  media.prefersDark = false;
  document.documentElement.removeAttribute('data-theme');
});

describe('App shell', () => {
  it('opens on Today with a greeting and the date in the user’s calendar', async () => {
    await renderApp();
    expect(await screen.findByRole('heading', { name: 'Good morning' })).toBeDefined();
    expect(screen.getByText('Saturday, March 21, 2026')).toBeDefined();
    expect(screen.getAllByRole('link', { name: 'Settings' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('status')[0]?.textContent).toBe('On this device only');
  });

  it('greets by the time of day in the user’s time zone', async () => {
    await renderApp({ clock: () => Date.UTC(2026, 2, 21, 10, 0) }); // 13:30 in Tehran
    expect(await screen.findByRole('heading', { name: 'Good afternoon' })).toBeDefined();
  });

  it('renders Persian, right to left, with a Jalali date and Persian digits', async () => {
    await renderApp({ language: 'fa' });
    expect(await screen.findByRole('heading', { name: 'صبح بخیر' })).toBeDefined();
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('fa');
    // Word order differs between ICU builds; check the parts instead.
    expect(
      screen.getByText((text) => text.includes('فروردین') && text.includes('۱۴۰۵')),
    ).toBeDefined();
  });

  it('switches language and direction live when the setting changes', async () => {
    const { settingsStore } = await renderApp({ path: '/settings' });
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeDefined();
    await act(() => settingsStore.update({ language: 'fa' }));
    expect(await screen.findByRole('heading', { name: 'تنظیمات' })).toBeDefined();
    expect(document.documentElement.dir).toBe('rtl');
  });
});

describe('Settings screen', () => {
  it('changes the calendar and digits independently of the language', async () => {
    const { settingsStore } = await renderApp({ path: '/settings' });
    const example = await screen.findByTestId('date-example');
    expect(example.textContent).toContain('March 21, 2026');
    fireEvent.click(screen.getByRole('radio', { name: 'Jalali (Solar Hijri)' }));
    await waitFor(() => expect(example.textContent).toContain('Farvardin 1, 1405'));
    expect(settingsStore.current().calendar).toBe('jalali');
    expect(settingsStore.current().language).toBe('en');
  });

  it('applies the theme setting, following the OS for "system"', async () => {
    media.prefersDark = true;
    await renderApp({ path: '/settings' });
    await screen.findByRole('heading', { name: 'Settings' });
    expect(document.documentElement.dataset['theme']).toBe('dark');
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    await waitFor(() => expect(document.documentElement.dataset['theme']).toBe('light'));
    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    await waitFor(() => expect(document.documentElement.dataset['theme']).toBe('dark'));
    media.prefersDark = false;
    act(() => media.listeners.forEach((l) => l()));
    await waitFor(() => expect(document.documentElement.dataset['theme']).toBe('light'));
  });
});
