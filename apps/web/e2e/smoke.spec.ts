import { expect, test } from '@playwright/test';

test('app boots and shows the title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Life Manager' })).toBeVisible();
});
