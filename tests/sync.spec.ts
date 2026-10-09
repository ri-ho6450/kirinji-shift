import { login } from './auth-helper';
import { test, expect } from '@playwright/test';
const emulator = 'http://127.0.0.1:8080';
const database = `${emulator}/v1/projects/demo-kirinji/databases/(default)/documents`;

test('shift/task edits sync between independent browsers and survive reload', async ({ browser, request }) => {
  test.skip(process.env.KIRINJI_SYNC_TEST !== '1', 'Run with npm run test:sync and the isolated emulator.');
  const cleared = await request.delete(`${emulator}/emulator/v1/projects/demo-kirinji/databases/(default)/documents`);
  expect(cleared.ok()).toBeTruthy();
  const seeded = await request.patch(`${database}/staff/1`, { headers: { Authorization: 'Bearer owner' }, data: { fields: {
    id: { stringValue: '1' }, name: { stringValue: 'テスト担当者' }, order: { integerValue: '0' },
  } } });
  expect(seeded.ok()).toBeTruthy();
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const [one, two] = await Promise.all(contexts.map(context => context.newPage()));
    await Promise.all([one.goto('http://127.0.0.1:3001'), two.goto('http://127.0.0.1:3001')]);
    for (const page of [one, two]) await login(page);
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
    const tasks = await request.get(`${database}/tasks`, { headers: { Authorization: 'Bearer owner' } });
    const documents = (await tasks.json()).documents;
    expect(documents).toHaveLength(1);
    expect(documents[0].fields.plan.stringValue).toBe('開店');
    expect(documents[0].fields.result.stringValue).toBe('休憩');
    const shifts = await request.get(`${database}/shifts`, { headers: { Authorization: 'Bearer owner' } });
    expect((await shifts.json()).documents[0].fields.code.stringValue).toBe('SH');
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});

test('compensatory leave is reassigned only when shift edit mode is released', async ({ page, request }) => {
  test.skip(process.env.KIRINJI_SYNC_TEST !== '1', 'Requires the isolated emulator.');
  await request.delete(`${emulator}/emulator/v1/projects/demo-kirinji/databases/(default)/documents`);
  const put = async (path: string, values: Record<string, string | boolean | number>) => {
    const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [key,
      typeof value === 'boolean' ? { booleanValue: value } : typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value },
    ]));
    const response = await request.patch(`${database}/${path}`, { headers: { Authorization: 'Bearer owner' }, data: { fields } });
    expect(response.ok()).toBeTruthy();
  };
  await put('staff/1', { id: '1', name: 'テスト担当者', order: 0 });
  for (const date of ['2026-09-22', '2026-09-23']) {
    await put(`holidays/${date}`, { date, isHoliday: true });
    await put(`shifts/${date}_1`, { date, staffId: '1', code: 'MO', locked: false });
  }
  await put('shifts/2026-09-24_1', { date: '2026-09-24', staffId: '1', code: '振休', compensatorySourceDate: '2026-09-22' });
  await put('shifts/2026-09-25_1', { date: '2026-09-25', staffId: '1', code: '振休', compensatorySourceDate: '2026-09-23', locked: true });
  await page.clock.setFixedTime(new Date('2026-10-06T03:00:00Z'));
  await page.goto('/');
  await login(page);
  await expect(page.getByRole('status')).toHaveText('Firebase 同期済み');
  const begin = async () => {
    await page.getByRole('button', { name: 'シフト編集', exact: true }).click();
    await page.locator('input[type=password]').fill('ks1311');
    await page.getByRole('button', { name: '認証', exact: true }).click();
  };
  const row = page.locator('table').first().locator('tbody tr').filter({ hasText: 'テスト担当者' }).first();
  const source = async (date: string) => {
    const response = await request.get(`${database}/shifts/${date}_1`, { headers: { Authorization: 'Bearer owner' } });
    if (response.status() === 404) return null;
    expect(response.ok()).toBeTruthy();
    return (await response.json()).fields.compensatorySourceDate?.stringValue || '';
  };
  const release = async () => {
    await page.getByRole('button', { name: '編集モード解除', exact: true }).click();
    await expect(page.getByRole('button', { name: 'シフト編集', exact: true })).toBeVisible();
  };
  await begin();
  await row.locator('td').nth(4).locator('select').selectOption(''); // September 24
  await expect(page.getByRole('status')).toHaveText('Firebase 同期済み');
  expect(await source('2026-09-25')).toBe('2026-09-23');
  await release();
  expect(await source('2026-09-25')).toBe('2026-09-22');
  await begin();
  await row.locator('td').nth(4).locator('select').selectOption('振休');
  await expect(page.getByRole('status')).toHaveText('Firebase 同期済み');
  await expect.poll(() => source('2026-09-24')).toBe('');
  expect(await source('2026-09-25')).toBe('2026-09-22');
  await release();
  expect(await source('2026-09-24')).toBe('2026-09-22');
  expect(await source('2026-09-25')).toBe('2026-09-23');
  const unchanged = await request.get(`${database}/shifts/2026-09-25_1`, { headers: { Authorization: 'Bearer owner' } });
  expect((await unchanged.json()).fields.locked.booleanValue).toBe(true);
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Firebase 同期済み');
  expect(await source('2026-09-25')).toBe('2026-09-23');
});

test('login gate, invalid password, unauthorized UID and server rules', async ({ page, request }) => {
  const publicRead = await request.get(`${database}/staff`);
  expect(publicRead.status()).toBe(403);
  await page.goto('/');
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.getByLabel('メールアドレス').fill('shared@example.test');
  await page.getByLabel('パスワード', { exact: true }).fill('incorrect');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('ログインできません');
  const signup = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', {
    data: { email: 'other@example.test', password: 'TestPassword123!', returnSecureToken: true },
  });
  expect(signup.ok()).toBeTruthy();
  const token = (await signup.json()).idToken;
  const headers = { Authorization: `Bearer ${token}` };
  expect((await request.get(`${database}/staff`, { headers })).status()).toBe(403);
  expect((await request.patch(`${database}/staff/forbidden`, { headers, data: { fields: { name: { stringValue: 'denied' } } } })).status()).toBe(403);
  await page.getByLabel('メールアドレス').fill('other@example.test');
  await page.getByLabel('パスワード', { exact: true }).fill('TestPassword123!');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('利用権限がありません');
  await expect(page.getByRole('table')).toHaveCount(0);
  await login(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'ログアウト', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});
