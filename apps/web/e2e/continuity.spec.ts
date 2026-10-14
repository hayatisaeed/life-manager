import { expect, test } from '@playwright/test';
const en = {
  start: 'Start with local storage',
  tasks: 'Tasks',
  notes: 'Notes',
  focus: 'Focus',
  today: 'Today',
  add: 'Add',
  title: 'Title',
  content: 'Content',
  save: 'Save',
  discard: 'Discard draft',
  priority: 'Priority',
  urgent: 'Urgent',
  backlog: 'Include undated backlog',
  begin: 'Start focus',
  pause: 'Pause',
  resume: 'Resume',
  finish: 'Finish session',
  capture: 'Quick capture',
  captured: 'Added to inbox.',
};
const fa: typeof en = {
  start: 'شروع با ذخیره‌سازی محلی',
  tasks: 'کارها',
  notes: 'یادداشت‌ها',
  focus: 'تمرکز',
  today: 'امروز',
  add: 'افزودن',
  title: 'عنوان',
  content: 'محتوا',
  save: 'ذخیره',
  discard: 'کنار گذاشتن پیش‌نویس',
  priority: 'اولویت',
  urgent: 'فوری',
  backlog: 'نمایش کارهای بدون تاریخ',
  begin: 'شروع تمرکز',
  pause: 'توقف',
  resume: 'ادامه',
  finish: 'پایان جلسه',
  capture: 'ثبت سریع',
  captured: 'به ورودی افزوده شد.',
};
test.beforeEach(async ({ page }, info) => {
  await page.addInitScript(
    ({ rtl, dark }) =>
      localStorage.setItem(
        'lm.preferences',
        JSON.stringify({
          language: rtl ? 'fa' : 'en',
          calendar: rtl ? 'jalali' : 'gregorian',
          digits: rtl ? 'persian' : 'latin',
          theme: dark ? 'dark' : 'light',
        }),
      ),
    { rtl: info.project.name.includes('rtl'), dark: info.project.name.includes('dark') },
  );
});
test('independent drafts survive navigation and Today backlog is opt-in', async ({
  page,
}, info) => {
  const labels = info.project.name.includes('rtl') ? fa : en;
  await page.goto('/');
  await page.getByRole('button', { name: labels.start }).click();
  await page.getByRole('button', { name: labels.notes, exact: true }).click();
  await page.getByRole('button', { name: labels.add, exact: true }).click();
  await page.getByLabel(labels.title, { exact: true }).fill('Unsaved note');
  await page.getByLabel(labels.content, { exact: true }).fill('Draft body survives navigation');
  await page.getByRole('button', { name: labels.tasks, exact: true }).click();
  await page.getByRole('button', { name: labels.add, exact: true }).click();
  await page.getByLabel(labels.title, { exact: true }).fill('Undated task');
  await page.getByLabel(labels.priority, { exact: true }).selectOption({ label: labels.urgent });
  await page.getByRole('button', { name: labels.notes, exact: true }).click();
  await page.getByRole('button', { name: labels.add, exact: true }).click();
  await expect(page.getByLabel(labels.title, { exact: true })).toHaveValue('Unsaved note');
  await expect(page.getByLabel(labels.content, { exact: true })).toHaveValue(
    'Draft body survives navigation',
  );
  await page.getByRole('button', { name: labels.save, exact: true }).click();
  await page.getByRole('button', { name: labels.tasks, exact: true }).click();
  await page.getByRole('button', { name: labels.add, exact: true }).click();
  await expect(page.getByLabel(labels.title, { exact: true })).toHaveValue('Undated task');
  await expect(page.getByLabel(labels.priority, { exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: labels.save, exact: true }).click();
  await page.getByRole('button', { name: labels.today, exact: true }).click();
  await expect(page.getByText('Undated task', { exact: true })).toHaveCount(0);
  await page.getByLabel(labels.backlog).check();
  await expect(page.getByText('Undated task', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: labels.notes, exact: true }).click();
  await page.keyboard.press('Control+k');
  await expect(page.getByLabel(labels.capture)).toBeFocused();
  await expect(page.getByRole('heading', { name: labels.notes, exact: true })).toBeVisible();
});
test('focus keeps running and paused state across module navigation', async ({ page }, info) => {
  const labels = info.project.name.includes('rtl') ? fa : en;
  await page.goto('/');
  await page.getByRole('button', { name: labels.start }).click();
  await page.getByRole('button', { name: labels.focus, exact: true }).click();
  await page.getByRole('button', { name: labels.begin, exact: true }).click();
  await page.getByRole('button', { name: labels.notes, exact: true }).click();
  await page.getByRole('button', { name: labels.focus, exact: true }).click();
  await expect(page.getByRole('button', { name: labels.pause, exact: true })).toBeVisible();
  await page.getByRole('button', { name: labels.pause, exact: true }).click();
  await page.getByRole('button', { name: labels.tasks, exact: true }).click();
  await page.getByRole('button', { name: labels.focus, exact: true }).click();
  await expect(page.getByRole('button', { name: labels.resume, exact: true })).toBeVisible();
  await page.getByRole('button', { name: labels.finish, exact: true }).click();
  await expect(page.getByRole('button', { name: labels.begin, exact: true })).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`focus-${width}.png`), fullPage: true });
  }
});
