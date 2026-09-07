import { test, expect } from '@playwright/test';
import { families } from '../fixtures/paraphrases.js';

test('real model answers, citation inspection, cached replay, and role isolation', async ({ page }, testInfo) => {
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Model-assisted answers', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'results/screenshots/live-workspace.png', fullPage: true });
  const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/ask') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /What are the limits for fee waivers/ }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const answer = await response.json();
  expect(answer.status).toBe('answered');
  expect(answer.meta.usage.model).toBe('gpt-4.1-mini-2025-04-14');
  expect(answer.meta.usage.calls).toBe(2);
  expect(answer.meta.usage.embeddings.calls).toBe(1);
  expect(answer.meta.retrieval.method).toBe('semantic+lexical');
  expect(answer.meta.usage.input_tokens).toBeGreaterThan(0);
  expect(answer.meta.receipt.hash).toMatch(/^[a-f0-9]{64}$/);
  await testInfo.attach('live-answer-and-usage', { body: JSON.stringify(answer, null, 2), contentType: 'application/json' });
  await expect(page.locator('.answer-body')).toContainText(/2,?500/);
  await page.getByRole('button', { name: 'Open evidence E1', exact: true }).first().click();
  await expect(page.locator('#selected-passage')).toContainText('₹2,500');
  await page.getByRole('button', { name: 'Close source', exact: true }).click();
  await page.screenshot({ path: 'results/screenshots/live-answer.png', fullPage: true });
  const replayPromise = page.waitForResponse(r => r.url().endsWith('/api/ask'));
  await page.locator('#ask-button').click();
  const replay = await (await replayPromise).json();
  expect(replay.meta.cache_hit).toBe(true);
  expect(replay.meta.usage.calls).toBe(0);
  expect(replay.answer).toBe(answer.answer);
  await page.getByLabel('Requester role').selectOption('public');
  await expect(page.locator('#nav-count')).toHaveText('25');
  await page.getByRole('button', { name: /What are the limits for fee waivers/ }).click();
  await expect(page.locator('.answer-state')).toHaveText('Access is required');
  await expect(page.locator('#answer-region')).not.toContainText('2,500');
  expect(browserErrors).toEqual([]);
});

test('real mobile question answers the payment hypothetical and rejects absent evidence', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/ask'));
  await page.getByRole('button', { name: /Can I schedule a payment 90 days ahead/ }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const answer = await response.json();
  expect(answer.status).toBe('answered');
  await expect(page.locator('.answer-body')).toContainText('60');
  await testInfo.attach('live-payment-answer', { body: JSON.stringify(answer, null, 2), contentType: 'application/json' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'results/screenshots/live-mobile.png', fullPage: true });
  await page.getByLabel('Your policy question').fill('What is the minimum CCTV retention period required for NBFC branch offices?');
  await page.getByLabel('Your policy question').press('Control+Enter');
  await expect(page.locator('.answer-state')).toHaveText('Not enough evidence in the book');
  await expect(page.locator('.evidence-card')).toHaveCount(0);
});

test('three differently worded questions preserve the payment rule, citations and role boundary', async ({ page }, testInfo) => {
  await page.goto('/');
  const results = [];
  for (const question of families.find(f => f.id === 'payment').questions) {
    await page.getByLabel('Your policy question').fill(question);
    const received = page.waitForResponse(r => r.url().endsWith('/api/ask') && r.request().method() === 'POST');
    await page.locator('#ask-button').click();
    const response = await received, answer = await response.json();
    expect(response.status()).toBe(200); expect(answer.status).toBe('answered');
    expect(answer.meta.retrieval.method).toBe('semantic+lexical');
    expect(answer.meta.usage.calls).toBe(2); expect(answer.meta.usage.embeddings.calls).toBe(1);
    expect(answer.citations.some(c => c.section === 'HARBOUR_internal_servicing_policy#s00002' && /60 days/.test(c.quote))).toBe(true);
    await expect(page.locator('.answer-body')).toContainText(/60|sixty/);
    results.push(answer);
  }
  await page.getByText('How this answer was checked', { exact: false }).click();
  await expect(page.locator('.trace')).toContainText('Meaning-based search');
  await expect(page.locator('.trace')).toContainText('1 embedding calls · 1 answer-model calls');
  await testInfo.attach('three-paraphrases-and-exact-citations', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: 'results/screenshots/semantic-paraphrase.png', fullPage: true });
  await page.getByLabel('Requester role').selectOption('public');
  await page.getByLabel('Your policy question').fill(families.find(f => f.id === 'payment').questions[2]);
  await page.locator('#ask-button').click();
  await expect(page.locator('.answer-state')).toHaveText('Access is required');
  await expect(page.locator('#answer-region')).not.toContainText('60 days');
});
