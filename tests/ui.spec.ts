import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  // UI checks are read-only and deterministic; never send requests to the shared database.
  await page.route('https://firestore.googleapis.com/**', route => route.abort());
  await page.goto('/');
});

test('monthly view, shift password gate, and individual/day navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await expect(page.getByRole('heading', { name: 'キリンジ シフト・作業割当' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(2);
  await page.getByRole('button', { name: 'シフト編集', exact: true }).click();
  await page.locator('input[type=password]').fill('wrong-password');
  await page.getByRole('button', { name: '認証', exact: true }).click();
  await expect(page.getByText('パスワードが正しくありません')).toBeVisible();
  await page.locator('input[type=password]').fill('ks1311');
  await page.getByRole('button', { name: '認証', exact: true }).click();
  await expect(page.getByRole('button', { name: '編集モード解除' })).toBeVisible();
  await expect(page.locator('select').first()).toBeVisible();
  await page.getByRole('button', { name: '編集モード解除' }).click();
  const staffRow = page.locator('table').first().locator('tbody tr').filter({ hasText: '田中リ' }).first();
  await staffRow.locator('td').nth(1).click();
  await expect(page.getByRole('button', { name: '実績出力' })).toBeVisible();
  await expect(page.getByText('計画', { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('all-staff daily timetable and authenticated settings tabs', async ({ page }) => {
  await page.getByRole('button', { name: '日別全体割当', exact: true }).click();
  await expect(page.getByRole('heading', { name: '日別全体作業割当', level: 2 })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '07:30' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '19:30' })).toBeVisible();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.locator('input[type=password]').fill('ks1311');
  await page.getByRole('button', { name: '認証', exact: true }).click();
  await expect(page.getByRole('heading', { name: '設定・管理画面' })).toBeVisible();
  for (const name of ['シフト略称', '作業略称', 'シフトパターン', '作業パターン', 'パソコンに保存']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name: '設定・管理画面' })).toBeVisible();
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'スタンドアロン版 (.html) をダウンロード', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('kirinji_shift_app.html');
  const html = await readFile((await file.path())!, 'utf8');
  expect(html).toContain('キリンジ シフト・作業割当');
  expect(html).not.toMatch(/<script[^>]+src=["']/);
});
