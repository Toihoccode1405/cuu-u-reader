import { test, expect } from '@playwright/test';
import { buildEpubBuffer, collectProblems, uniqueName, PASSWORD } from './helpers.js';

// S5 - Luồng người dùng thật trên bản build chạy bằng Worker cục bộ
test('đăng ký, đưa sách lên, đọc chương, đăng xuất', async ({ page }) => {
  const problems = collectProblems(page);
  const name = uniqueName();

  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng Ký Mới' }).click();
  await page.getByPlaceholder('Nhập tên tài khoản...').fill(name);
  const passwords = page.locator('input[type="password"]');
  await passwords.nth(0).fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
  await page.locator('button[type="submit"]').click();

  // Thư các trống sau khi đăng ký
  await expect(page.getByText('Thư các của bạn hiện đang trống')).toBeVisible();

  // Đưa sách lên bằng ô chọn file
  const epub = await buildEpubBuffer('Sach E2E');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'sach-e2e.epub', mimeType: 'application/epub+zip', buffer: epub,
  });
  await expect(page.getByText('Sach E2E').first()).toBeVisible({ timeout: 20_000 });

  // Mở sách và thấy nội dung chương 1
  await page.getByText('Sach E2E').first().click();
  await expect(page.locator('.reader-body')).toContainText('Noi dung chuong mot', { timeout: 20_000 });

  // Sang chương kế bằng nút chuyển chương
  await page.getByTitle(/Chương sau|Chương kế|Chương tiếp/).first().click();
  await expect(page.locator('.reader-body')).toContainText('Noi dung chuong hai', { timeout: 20_000 });

  // Không có lỗi console hay lỗi CSP suốt luồng
  expect(problems).toEqual([]);
});

test('đăng nhập sai mật khẩu hiện thông báo và không vào được', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Nhập tên tài khoản...').fill('khong_ton_tai_' + uniqueName());
  await page.locator('input[type="password"]').first().fill('sai-mat-khau-xyz');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText('Tài khoản hoặc mật khẩu không chính xác')).toBeVisible();
  await expect(page.getByText('Thư các của bạn')).toHaveCount(0);
});

test('đăng xuất đưa về trang đăng nhập và xóa phiên', async ({ page }) => {
  const name = uniqueName();
  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng Ký Mới' }).click();
  await page.getByPlaceholder('Nhập tên tài khoản...').fill(name);
  const passwords = page.locator('input[type="password"]');
  await passwords.nth(0).fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText('Thư các của bạn hiện đang trống')).toBeVisible();

  await page.getByTitle('Đăng xuất', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đăng Nhập' }).first()).toBeVisible();

  // Tải lại trang vẫn ở trang đăng nhập (phiên đã bị xóa)
  await page.reload();
  await expect(page.getByPlaceholder('Nhập tên tài khoản...')).toBeVisible();
});
