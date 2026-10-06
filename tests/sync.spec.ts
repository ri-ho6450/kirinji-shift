import { test, expect } from '@playwright/test';
const emulator = 'http://127.0.0.1:8080';
const database = `${emulator}/v1/projects/demo-kirinji/databases/(default)/documents`;

test('shift/task edits sync between independent browsers and survive reload', async ({ browser, request }) => {
  test.skip(process.env.KIRINJI_SYNC_TEST !== '1', 'Run with npm run test:sync and the isolated emulator.');
  const cleared = await request.delete(`${emulator}/emulator/v1/projects/demo-kirinji/databases/(default)/documents`);
  expect(cleared.ok()).toBeTruthy();
  const seeded = await request.patch(`${database}/staff/1`, { data: { fields: {
    id: { stringValue: '1' }, name: { stringValue: 'テスト担当者' }, order: { integerValue: '0' },
  } } });
  expect(seeded.ok()).toBeTruthy();
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const [one, two] = await Promise.all(contexts.map(context => context.newPage()));
    await Promise.all([one.goto('http://127.0.0.1:3001'), two.goto('http://127.0.0.1:3001')]);
    for (const page of [one, two]) await expect(page.getByRole('status')).toHaveText('Firebase 同期済み');
    await one.getByRole('button', { name: 'シフト編集', exact: true }).click();
    await one.locator('input[type=password]').fill('ks1311');
    await one.getByRole('button', { name: '認証', exact: true }).click();
    const row = (page: typeof one) => page.locator('table').first().locator('tbody tr').filter({ hasText: 'テスト担当者' }).first();
    await row(one).locator('select').first().selectOption('SH');
    await expect(row(two).locator('td').nth(1)).toHaveText('S');
    await expect(one.getByRole('status')).toHaveText('Firebase 同期済み');
    await one.getByRole('button', { name: '編集モード解除' }).click();
    await row(one).locator('td').nth(1).click();
    await row(two).locator('td').nth(1).click();
    await one.getByRole('button', { name: '-', exact: true }).first().click();
    await one.getByRole('button', { name: '開店', exact: true }).click();
    await expect(two.getByRole('button', { name: '開店', exact: true })).toBeVisible();
    await expect(one.getByRole('status')).toHaveText('Firebase 同期済み');
    await two.reload();
    await row(two).locator('td').nth(1).click();
    await expect(two.getByRole('button', { name: '開店', exact: true })).toBeVisible();
    // Offline edits must remain local until reconnection, then reach the other device.
    await contexts[0].setOffline(true);
    await one.getByRole('button', { name: '-', exact: true }).first().click();
    await one.getByRole('button', { name: '休憩', exact: true }).click();
    await expect(one.getByRole('button', { name: '休憩', exact: true })).toBeVisible();
    await expect(one.getByRole('status')).toHaveText('変更を送信中');
    await expect(two.getByRole('button', { name: '休憩', exact: true })).toHaveCount(0);
    await contexts[0].setOffline(false);
    await expect(two.getByRole('button', { name: '休憩', exact: true })).toBeVisible({ timeout: 15000 });
    await expect(one.getByRole('status')).toHaveText('Firebase 同期済み');
    const tasks = await request.get(`${database}/tasks`);
    const documents = (await tasks.json()).documents;
    expect(documents).toHaveLength(1);
    expect(documents[0].fields.plan.stringValue).toBe('開店');
    expect(documents[0].fields.result.stringValue).toBe('休憩');
    const shifts = await request.get(`${database}/shifts`);
    expect((await shifts.json()).documents[0].fields.code.stringValue).toBe('SH');
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
