import { test, expect } from '@playwright/test';

test('列表搜索、分页和编辑主流程 @critical', async ({ page }) => {
  await page.goto('/orders');

  await expect(page.getByRole('heading', { name: '订单列表' })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();

  await page.getByLabel('搜索订单').fill('ORD-001');
  const searchRequest = page.waitForRequest(request =>
    request.url().includes('/api/orders') && request.method() === 'GET'
  );
  await page.getByRole('button', { name: '搜索' }).click();
  const request = await searchRequest;
  expect(request.url()).toContain('page=1');

  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page).toHaveURL(/page=2/);

  await page.getByRole('button', { name: '编辑' }).first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await drawer.getByLabel('备注').fill('需要尽快处理');

  const saveRequest = page.waitForRequest(request =>
    request.url().includes('/api/orders/') && request.method() === 'PATCH'
  );
  await drawer.getByRole('button', { name: '保存' }).click();
  expect((await saveRequest).postDataJSON()).toMatchObject({
    remark: '需要尽快处理',
  });
  await expect(page.getByText('保存成功')).toBeVisible();
});
