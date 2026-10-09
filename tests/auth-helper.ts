import { expect, type Page } from '@playwright/test';

export async function login(page: Page) {
  const response = await page.request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-kirinji/accounts', {
    headers: { Authorization: 'Bearer owner' },
    data: { localId: 'kirinji-test-user', email: 'shared@example.test', password: 'TestPassword123!' },
  });
  if (!response.ok()) {
    // An already registered emulator account is expected between independent browsers.
    expect((await response.json()).error.message).toMatch(/EXISTS|DUPLICATE_LOCAL_ID/);
  }
  await page.getByLabel('メールアドレス').fill('shared@example.test');
  await page.getByLabel('パスワード', { exact: true }).fill('TestPassword123!');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ログアウト', exact: true })).toBeVisible();
}
