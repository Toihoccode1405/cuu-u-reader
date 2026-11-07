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
  await page.getByRole('heading', { name: 'Sach E2E', level: 4 }).click();
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

test('phiên là cookie HttpOnly: JavaScript và localStorage không thấy token, tải lại trang vẫn đăng nhập', async ({ page, context }) => {
  const name = uniqueName();
  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng Ký Mới' }).click();
  await page.getByPlaceholder('Nhập tên tài khoản...').fill(name);
  const passwords = page.locator('input[type="password"]');
  await passwords.nth(0).fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText('Thư các của bạn hiện đang trống')).toBeVisible();

  // Cookie phiên có thật và đúng thuộc tính
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === '__Host-session');
  expect(session).toBeTruthy();
  expect(session.httpOnly).toBe(true);
  expect(session.secure).toBe(true);
  expect(session.sameSite).toBe('Strict');

  // JavaScript không đọc được cookie, và không có token trong bộ nhớ trình duyệt
  const seen = await page.evaluate(() => ({
    cookie: document.cookie,
    local: JSON.stringify(Object.entries(localStorage)),
    sessionStore: JSON.stringify(Object.entries(sessionStorage)),
  }));
  expect(seen.cookie).not.toContain('__Host-session');
  expect(seen.local).not.toMatch(/token|session/i);
  expect(seen.sessionStore).not.toMatch(/token|session/i);

  // Tải lại trang vẫn đăng nhập (máy chủ nhận ra cookie)
  await page.reload();
  await expect(page.getByText('Thư các của bạn hiện đang trống')).toBeVisible();
});

test('đăng xuất mọi thiết bị: phiên ở thiết bị khác cũng mất hiệu lực', async ({ browser }) => {
  const name = uniqueName();
  const phone = await (await browser.newContext()).newPage();
  await phone.goto('/');
  await phone.getByRole('button', { name: 'Đăng Ký Mới' }).click();
  await phone.getByPlaceholder('Nhập tên tài khoản...').fill(name);
  const pw = phone.locator('input[type="password"]');
  await pw.nth(0).fill(PASSWORD);
  await pw.nth(1).fill(PASSWORD);
  await phone.locator('button[type="submit"]').click();
  await expect(phone.getByText('Thư các của bạn hiện đang trống')).toBeVisible();

  // Thiết bị thứ hai đăng nhập cùng tài khoản
  const pc = await (await browser.newContext()).newPage();
  await pc.goto('/');
  await pc.getByPlaceholder('Nhập tên tài khoản...').fill(name);
  await pc.locator('input[type="password"]').first().fill(PASSWORD);
  await pc.locator('button[type="submit"]').click();
  await expect(pc.getByText('Thư các của bạn hiện đang trống')).toBeVisible();

  // Từ điện thoại bấm "Đăng xuất mọi thiết bị"
  phone.once('dialog', (d) => d.accept());
  await phone.getByTitle('Đăng xuất mọi thiết bị').click();
  await expect(phone.getByPlaceholder('Nhập tên tài khoản...')).toBeVisible();

  // Máy tính: tải lại trang thì phải về trang đăng nhập
  await pc.reload();
  await expect(pc.getByPlaceholder('Nhập tên tài khoản...')).toBeVisible();
});

test('xóa token cũ còn sót trong localStorage từ phiên bản trước', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cuu_u_cloud_token', 'token-cu-con-sot');
    localStorage.setItem('cuu_u_cloud_user', '{"username":"cu"}');
  });
  await page.goto('/');
  await expect(page.getByPlaceholder('Nhập tên tài khoản...')).toBeVisible();
  const left = await page.evaluate(() => [localStorage.getItem('cuu_u_cloud_token'), localStorage.getItem('cuu_u_cloud_user')]);
  expect(left).toEqual([null, null]);
});
