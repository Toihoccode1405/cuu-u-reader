import { test, expect } from '@playwright/test';
import { buildEpubBuffer, uniqueName, PASSWORD } from './helpers.js';

async function registerViaUi(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng Ký Mới' }).click();
  await page.getByPlaceholder('Nhập tên tài khoản...').fill(uniqueName());
  const passwords = page.locator('input[type="password"]');
  await passwords.nth(0).fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText('Thư các của bạn hiện đang trống')).toBeVisible();
}

async function uploadAndRead(page, title) {
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'off.epub', mimeType: 'application/epub+zip', buffer: await buildEpubBuffer(title),
  });
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 });
  await page.getByText(title).first().click();
  await expect(page.locator('.reader-body')).toContainText('Noi dung chuong mot', { timeout: 20_000 });
}

// Service Worker phải đã kiểm soát trang trước khi ngắt mạng
async function waitForServiceWorker(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 10_000 }).toBe(true);
}

test('Offline: mất mạng vẫn mở được thư các và đọc lại chương đã đọc', async ({ page, context }) => {
  await registerViaUi(page);
  await uploadAndRead(page, 'Sach Offline');
  await waitForServiceWorker(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Sach Offline').first()).toBeVisible({ timeout: 15_000 });
  await page.getByText('Sach Offline').first().click();
  await expect(page.locator('.reader-body')).toContainText('Noi dung chuong mot', { timeout: 15_000 });
  await context.setOffline(false);
});

test('Offline: đăng xuất xóa sạch dữ liệu đã lưu, mất mạng rồi cũng không vào được thư các', async ({ page, context }) => {
  await registerViaUi(page);
  await uploadAndRead(page, 'Sach Rieng Tu');
  await waitForServiceWorker(page);

  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click({ timeout: 8000 });
  await expect(page.getByRole('button', { name: 'Đăng Ký Mới' })).toBeVisible();

  const leftover = await page.evaluate(async () => {
    const out = [];
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      for (const req of await c.keys()) if (new URL(req.url).pathname.startsWith('/api/')) out.push(req.url);
    }
    return out;
  });
  expect(leftover).toEqual([]);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Đăng Ký Mới' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Sach Rieng Tu')).toHaveCount(0);
  await context.setOffline(false);
});
