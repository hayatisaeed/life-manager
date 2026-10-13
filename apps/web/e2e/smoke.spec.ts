import { expect, test } from '@playwright/test';
const english = {
  app: 'Life Manager',
  start: 'Start with local storage',
  tasks: 'Tasks',
  notes: 'Notes',
  habits: 'Habits',
  money: 'Money',
  accounts: 'Accounts',
  health: 'Health',
  people: 'People',
  library: 'Library',
  goals: 'Goals',
  add: 'Add',
  save: 'Save',
  title: 'Title',
  name: 'Name',
  content: 'Content',
  remove: 'Delete',
  undo: 'Undo delete',
  due: 'Due date',
  logged: 'Logged today',
  log: 'Log today',
  amount: 'Amount in minor units',
  account: 'Account',
  unit: 'Unit',
  value: 'Value',
};
const persian: typeof english = {
  app: 'مدیریت زندگی',
  start: 'شروع با ذخیره‌سازی محلی',
  tasks: 'کارها',
  notes: 'یادداشت‌ها',
  habits: 'عادت‌ها',
  money: 'مالی',
  accounts: 'حساب‌ها',
  health: 'سلامتی',
  people: 'افراد',
  library: 'کتابخانه',
  goals: 'هدف‌ها',
  add: 'افزودن',
  save: 'ذخیره',
  title: 'عنوان',
  name: 'نام',
  content: 'محتوا',
  remove: 'حذف',
  undo: 'بازگردانی حذف',
  due: 'مهلت',
  logged: 'امروز ثبت شد',
  log: 'ثبت امروز',
  amount: 'مبلغ در واحد خرد ارز',
  account: 'حساب',
  unit: 'واحد',
  value: 'مقدار',
};
test.beforeEach(async ({ page }, info) => {
  const rtl = info.project.name.includes('rtl');
  await page.addInitScript(
    ({ rtl, dark }) => {
      localStorage.setItem(
        'lm.preferences',
        JSON.stringify({
          language: rtl ? 'fa' : 'en',
          calendar: rtl ? 'jalali' : 'gregorian',
          digits: rtl ? 'persian' : 'latin',
          theme: dark ? 'dark' : 'light',
        }),
      );
    },
    { rtl, dark: info.project.name.includes('dark') },
  );
});
test('local onboarding, task persistence, delete and undo', async ({ page }, info) => {
  const labels = info.project.name.includes('rtl') ? persian : english;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: labels.app, exact: true })).toBeVisible();
  await page.getByRole('button', { name: labels.start }).click();
  await page.getByRole('button', { name: labels.tasks, exact: true }).click();
  await page.getByRole('button', { name: labels.add, exact: true }).click();
  await page.getByLabel(labels.title, { exact: true }).fill('E2E task');
  await page.getByRole('button', { name: labels.save, exact: true }).click();
  await expect(page.getByText('E2E task', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: labels.tasks, exact: true }).click();
  await expect(page.getByText('E2E task', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: labels.remove, exact: true }).click();
  await expect(page.getByText('E2E task', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: labels.undo, exact: true }).click();
  await expect(page.getByText('E2E task', { exact: true })).toBeVisible();
});
test('notes, habits, people, library, goals and health save locally', async ({ page }, info) => {
  const labels = info.project.name.includes('rtl') ? persian : english;
  await page.goto('/');
  await page.getByRole('button', { name: labels.start }).click();
  for (const [module, field, title] of [
    [labels.notes, labels.title, 'E2E note'],
    [labels.habits, labels.name, 'E2E habit'],
    [labels.people, labels.name, 'E2E person'],
    [labels.library, labels.title, 'E2E book'],
    [labels.goals, labels.title, 'E2E goal'],
  ]) {
    if (!module || !field || !title) throw new Error('Invalid feature fixture');
    await page.getByRole('button', { name: module, exact: true }).click();
    await page.getByRole('button', { name: labels.add, exact: true }).click();
    await page.getByLabel(field, { exact: true }).fill(title);
    await page.getByRole('button', { name: labels.save, exact: true }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: labels.habits, exact: true }).click();
  await page.getByRole('button', { name: labels.log, exact: true }).click();
  await expect(page.getByRole('button', { name: labels.logged, exact: true })).toBeDisabled();
  await page.getByRole('button', { name: labels.health, exact: true }).click();
  await page.getByRole('button', { name: labels.add, exact: true }).click();
  await page.getByLabel(labels.unit, { exact: true }).fill('cups');
  await page.getByRole('button', { name: labels.save, exact: true }).click();
  await expect(page.getByText(/cups/)).toBeVisible();
});
test('accounts and integer-minor-unit transactions', async ({ page }, info) => {
  const labels = info.project.name.includes('rtl') ? persian : english;
  await page.goto('/');
  await page.getByRole('button', { name: labels.start }).click();
  await page.getByRole('button', { name: labels.money, exact: true }).click();
  await page.getByRole('button', { name: labels.accounts, exact: true }).click();
  await page.getByRole('button', { name: labels.add, exact: true }).click();
  await page.getByLabel(labels.name, { exact: true }).fill('Test account');
  await page.getByRole('button', { name: labels.save, exact: true }).click();
  await expect(page.getByText('Test account', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: labels.money, exact: true }).click();
  await page.getByRole('button', { name: labels.add, exact: true }).click();
  await page.getByLabel(labels.amount, { exact: true }).fill('-1250');
  await page.getByLabel(labels.account, { exact: true }).selectOption({ label: 'Test account' });
  await page.getByRole('button', { name: labels.save, exact: true }).click();
  await expect(page.getByRole('button', { name: labels.remove, exact: true })).toBeVisible();
});

test('responsive layout has no page overflow', async ({ page }, info) => {
  const labels = info.project.name.includes('rtl') ? persian : english;
  await page.goto('/');
  await page.getByRole('button', { name: labels.start }).click();
  await page.getByRole('button', { name: labels.tasks, exact: true }).click();
  await expect(page.getByRole('button', { name: labels.add, exact: true })).toBeEnabled();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: labels.tasks, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`workspace-${width}.png`), fullPage: true });
  }
});
