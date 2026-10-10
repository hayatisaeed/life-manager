import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const rtl = (info: TestInfo) => info.project.name.endsWith('rtl');
const dark = (info: TestInfo) => info.project.name.startsWith('dark');

/** Strings the tests look for, in the project's language. */
const text = (info: TestInfo) =>
  rtl(info)
    ? {
        settings: 'تنظیمات',
        otherTab: 'مدیر زندگی در زبانه‌ی دیگری باز است.',
        useHere: 'استفاده در این‌جا',
        dark: 'تیره',
        jalali: 'شمسی (هجری خورشیدی)',
        gregorian: 'میلادی',
      }
    : {
        settings: 'Settings',
        otherTab: 'Life Manager is open in another tab.',
        useHere: 'Use it here',
        dark: 'Dark',
        jalali: 'Jalali (Solar Hijri)',
        gregorian: 'Gregorian',
      };

async function expectNoA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test('boots into Today in the browser language, theme and direction', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', rtl(info) ? 'rtl' : 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', rtl(info) ? 'fa' : 'en');
  await expect(page.locator('html')).toHaveAttribute('data-theme', dark(info) ? 'dark' : 'light');
  await expectNoA11yViolations(page);
});

test('settings are saved to the local database and survive a reload', async ({ page }, info) => {
  const t = text(info);
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { level: 1, name: t.settings })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('radio', { name: t.dark }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const calendar = rtl(info) ? t.gregorian : t.jalali; // switch away from the default
  const before = (await page.getByTestId('date-example').textContent()) ?? '';
  await page.getByRole('radio', { name: calendar }).click();
  await expect(page.getByRole('radio', { name: calendar })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('date-example')).not.toHaveText(before);
  const example = await page.getByTestId('date-example').textContent();
  await expect(page.getByTestId('settings')).toHaveAttribute('aria-busy', 'false');

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: t.settings })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('radio', { name: calendar })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('date-example')).toHaveText(example ?? '');
});

test('one tab owns the database; another can take over', async ({ context }, info) => {
  const t = text(info);
  const first = await context.newPage();
  await first.goto('/');
  await expect(first.locator('h1')).toBeVisible();
  await expect(first.locator('h1')).not.toHaveText(t.otherTab);

  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('heading', { name: t.otherTab })).toBeVisible();
  await second.getByRole('button', { name: t.useHere }).click();
  await expect(second.getByRole('link', { name: t.settings }).first()).toBeVisible();
  await expect(first.getByRole('heading', { name: t.otherTab })).toBeVisible();
});
