import { test, expect } from '@playwright/test';
import { buildEpubBuffer, collectProblems, uniqueName, PASSWORD } from './helpers.js';

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

async function extractedCount(page, bookId) {
  const res = await page.request.get(`/api/books/${bookId}/extracted`);
  const data = await res.json();
  return { total: data.total, count: data.extracted.length };
}

test('Tách chương: đưa sách lên xong thì mọi chương được tách sẵn trên máy chủ', async ({ page }) => {
  const problems = collectProblems(page);
  await registerViaUi(page);

  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'tach.epub', mimeType: 'application/epub+zip', buffer: await buildEpubBuffer('Sach Tach'),
  });
  await expect(page.getByText('Sach Tach').first()).toBeVisible({ timeout: 20_000 });

  const books = await (await page.request.get('/api/books')).json();
  const bookId = books[0].id;
  await expect.poll(() => extractedCount(page, bookId).then((r) => r.count), { timeout: 20_000 }).toBe(3);
  expect(problems).toEqual([]);
});

test('Tách bù: mở sách cũ chưa được tách thì chương được bổ sung ở nền, vẫn đọc bình thường', async ({ page, baseURL }) => {
  await registerViaUi(page);

  // Mô phỏng sách đưa lên từ trước khi có Tách chương: gửi thẳng lên máy chủ, không qua giao diện
  const up = await page.request.post('/api/books/upload', {
    headers: { Origin: baseURL },
    multipart: { file: { name: 'cu.epub', mimeType: 'application/epub+zip', buffer: await buildEpubBuffer('Sach Cu') } },
  });
  expect(up.ok()).toBe(true);
  const { id: bookId } = await up.json();
  expect((await extractedCount(page, bookId)).count).toBe(0);

  await page.reload();
  await page.getByRole('heading', { name: 'Sach Cu', level: 4 }).click();
  await expect(page.locator('.reader-body')).toContainText('Noi dung chuong mot', { timeout: 20_000 });

  // Chương còn lại được tách bù ở nền
  await expect.poll(() => extractedCount(page, bookId).then((r) => r.count), { timeout: 20_000 }).toBe(3);
});

test('Tách bù không ghi đè chương người đọc đã sửa', async ({ page, baseURL }) => {
  await registerViaUi(page);
  const up = await page.request.post('/api/books/upload', {
    headers: { Origin: baseURL },
    multipart: { file: { name: 'sua.epub', mimeType: 'application/epub+zip', buffer: await buildEpubBuffer('Sach Sua') } },
  });
  const { id: bookId } = await up.json();
  await page.request.put(`/api/books/${bookId}/chapters/2`, {
    headers: { Origin: baseURL },
    data: { title: 'Chuong 2', content_html: '<p>Ban da duoc sua tay</p>' },
  });

  await page.reload();
  await page.getByRole('heading', { name: 'Sach Sua', level: 4 }).click();
  await expect(page.locator('.reader-body')).toContainText('Noi dung chuong mot', { timeout: 20_000 });
  await expect.poll(() => extractedCount(page, bookId).then((r) => r.count), { timeout: 20_000 }).toBe(3);

  const ch2 = await (await page.request.get(`/api/books/${bookId}/chapters/2`)).json();
  expect(ch2.content_html).toContain('Ban da duoc sua tay');
});
