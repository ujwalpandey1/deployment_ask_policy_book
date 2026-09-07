import { test, expect } from '@playwright/test';

test('ask, inspect an exact citation, export evidence, and change role safely', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Ask the policy book.' })).toBeVisible();
  await page.screenshot({ path: 'results/screenshots/workspace.png', fullPage: true });
  await page.getByRole('button', { name: /What are the limits for fee waivers/ }).click();
  await expect(page.locator('.answer-body')).toContainText('₹2,500');
  await page.getByRole('button', { name: 'Open evidence E1', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Harbour servicing policy' })).toBeVisible();
  await expect(page.locator('#selected-passage')).toContainText('no more than two fees');
  await page.getByRole('button', { name: 'Close source', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/policy-answer/);
  await page.screenshot({ path: 'results/screenshots/answer.png', fullPage: true });
  await page.getByLabel('Requester role').selectOption('public');
  await expect(page.locator('.answer-body')).toHaveCount(0);
  await page.getByRole('button', { name: /What are the limits for fee waivers/ }).click();
  await expect(page.locator('.answer-state')).toHaveText('Access is required');
  await expect(page.locator('#answer-region')).not.toContainText('₹2,500');
  await expect(page.locator('.evidence-card')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('library filtering, synthetic freshness rehearsal, timeline and audit are functional', async ({ page }) => {
  await page.goto('/'); await page.locator('.nav-item[data-view="library"]').click();
  await expect(page.locator('.document-card')).toHaveCount(28);
  await page.getByRole('button', { name: 'Internal', exact: true }).click(); await expect(page.locator('.document-card')).toHaveCount(1);
  await page.getByLabel('Search documents').fill('nothing-matches-this'); await expect(page.getByText('No accessible documents match your search.')).toBeVisible();
  await page.locator('.nav-item[data-view="assurance"]').click(); await page.getByRole('button', { name: 'Run rehearsal' }).click();
  await expect(page.getByText('6 of 6 synthetic checks passed')).toBeVisible();
  await page.locator('.nav-item[data-view="timeline"]').click();
  await page.locator('#compare-question').fill('What are the limits for fee waivers?');
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.locator('.comparison-box')).toHaveCount(2);
  await page.locator('.nav-item[data-view="audit"]').click(); await expect(page.locator('table')).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
});

test('mobile layout, keyboard submission and hostile text do not execute markup', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ask the policy book.' })).toBeVisible();
  await page.screenshot({ path: 'results/screenshots/mobile.png', fullPage: true });
  await page.getByLabel('Your policy question').fill('<img src=x onerror="window.pwned=true"> What are payment scheduling limits?');
  await page.getByLabel('Your policy question').press('Control+Enter');
  await expect(page.locator('.answer-panel')).toBeVisible();
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Toggle menu' }).click();
  await page.locator('.nav-item[data-view="library"]').click(); await expect(page.getByRole('heading', { name: 'A well-kept policy book.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
