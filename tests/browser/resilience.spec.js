import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('a provider outage is an error, and the question can be retried', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/ask', route => route.fulfill({ status: 503, json: { error: { message: 'The reasoning service is unavailable. Please retry.' } } }));
  await page.getByRole('button', { name: /What are the limits for fee waivers/ }).click();
  await expect(page.getByRole('alert')).toContainText('reasoning service is unavailable');
  await expect(page.locator('.answer-state')).toHaveCount(0);
  await expect(page.locator('#ask-button')).toBeEnabled();
  await page.unroute('**/api/ask');
  await page.locator('#ask-button').click();
  await expect(page.locator('.answer-body')).toContainText('₹2,500');
});

test('changing role during a pending answer cannot display the old scope', async ({ page }) => {
  await page.goto('/');
  let release, entered;
  const pending = new Promise(resolve => { release = resolve; });
  const intercepted = new Promise(resolve => { entered = resolve; });
  await page.route('**/api/ask', async route => {
    const response = await route.fetch();
    entered();
    await pending;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.getByRole('button', { name: /What are the limits for fee waivers/ }).click();
  await intercepted;
  await expect(page.locator('#ask-button')).toBeDisabled();
  await page.getByLabel('Requester role').selectOption('public');
  await expect(page.locator('#nav-count')).toHaveText('25');
  release();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.locator('.answer-body')).toHaveCount(0);
  await expect(page.locator('.recent-item')).toHaveCount(0);
  await expect(page.locator('#page')).not.toContainText('₹2,500');
  await page.getByRole('button', { name: /What are the limits for fee waivers/ }).click();
  await expect(page.locator('.answer-state')).toHaveText('Access is required');
});

test('timeline source links retain the compared date and exact section', async ({ page }) => {
  await page.goto('/');
  await page.locator('.nav-item[data-view="timeline"]').click();
  await page.locator('#compare-question').fill('What are the fee waiver limits?');
  await page.locator('#before-date').fill('2026-02-01');
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.locator('.comparison-box')).toHaveCount(2);
  const sourceRequest = page.waitForRequest(r => r.url().includes('/api/documents/HARBOUR_'));
  await page.locator('.comparison-box').first().getByRole('button', { name: 'Open source' }).first().click();
  expect(new URL((await sourceRequest).url()).searchParams.get('as_of')).toBe('2026-02-01');
  await expect(page.locator('#selected-passage')).toContainText('₹2,500');
});

test('export contains the answer receipt and scope without storing browser secrets', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /What are the limits for fee waivers/ }).click();
  await expect(page.locator('.answer-body')).toContainText('₹2,500');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const result = JSON.parse(await readFile(await (await downloaded).path(), 'utf8'));
  expect(result.role).toBe('ops');
  expect(result.meta.receipt.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.citations[0].verified).toBe(true);
  expect(result.meta.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  await page.reload();
  await expect(page.locator('.recent-item')).toHaveCount(0);
});

test('unsupported arithmetic is visibly flagged and usage is inspectable', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/ask', async route => {
    const response = await route.fetch();
    const answer = await response.json();
    answer.meta.checks.arithmetic_verified = false;
    answer.meta.checks.arithmetic_receipts_withheld = 1;
    await route.fulfill({ json: answer });
  });
  await page.getByRole('button', { name: /What are the limits for fee waivers/ }).click();
  await expect(page.getByRole('note')).toContainText('Arithmetic review needed');
  await page.getByText('How this answer was checked', { exact: false }).click();
  await expect(page.getByText('Usage for this request', { exact: true })).toBeVisible();
  await expect(page.locator('.trace')).toContainText('0 API calls');
});

test('a refusal explains a retrieval miss rather than asserting the policy is absent', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Your policy question').fill('What is the capital of France?');
  await page.locator('#ask-button').click();
  await expect(page.locator('.answer-state')).toHaveText('Not enough evidence in the book');
  await expect(page.locator('.refusal-detail')).toContainText('The answer model was not called');
  await page.getByText('How this answer was checked', { exact: false }).click();
  await expect(page.locator('.trace')).toContainText('Search did not find sufficiently relevant evidence');
});
