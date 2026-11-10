import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { collectProblems, uniqueName, PASSWORD } from './helpers.js';

const words = (n) => Array(n).fill('tu').join(' ');

// EPUB nhiều chương, mỗi chương một đoạn có số từ cho trước
async function epubWithWords(title, perChapter) {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const items = perChapter.map((_, i) => `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('');
  const spine = perChapter.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>Tac Gia</dc:creator></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${items}</manifest><spine toc="ncx">${spine}</spine></package>`);
  const points = perChapter.map((_, i) => `<navPoint id="n${i + 1}"><navLabel><text>Chuong ${i + 1}</text></navLabel><content src="c${i + 1}.xhtml"/></navPoint>`).join('');
  z.file('OEBPS/toc.ncx', `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>${points}</navMap></ncx>`);
  perChapter.forEach((n, i) => z.file(`OEBPS/c${i + 1}.xhtml`, `<html><body><p>${words(n)}</p></body></html>`));
  return Buffer.from(await z.generateAsync({ type: 'uint8array' }));
}

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

// Người đọc có sẵn sách và tiến độ từ trước khi vào giao diện (như người dùng cũ): cộng hồi tố chạy ở lần mở đầu tiên
async function registerViaApi(page, baseURL) {
  const res = await page.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: { username: uniqueName(), password: PASSWORD },
  });
  expect(res.ok()).toBe(true);
}

async function uploadViaApi(page, baseURL, title, perChapter) {
  const up = await page.request.post('/api/books/upload', {
    headers: { Origin: baseURL },
    multipart: { file: { name: 'tu.epub', mimeType: 'application/epub+zip', buffer: await epubWithWords(title, perChapter) } },
  });
  expect(up.ok()).toBe(true);
  return (await up.json()).id;
}

const setProgress = (page, baseURL, bookId, chapter) =>
  page.request.post(`/api/books/${bookId}/progress`, {
    headers: { Origin: baseURL },
    data: { chapter_index: chapter, scroll_percent: 0, para_index: 0 },
  });

const tuVi = async (page) => (await (await page.request.get('/api/cultivation')).json()).tu_vi;

test('Tu vi: người đọc mới thấy Ngưng Khí tầng 1 ở thư các', async ({ page }) => {
  const problems = collectProblems(page);
  await registerViaUi(page);
  const chip = page.getByTestId('cultivation-chip');
  await expect(chip).toContainText('Ngưng Khí');
  await expect(chip).toContainText('tầng 1');
  expect(problems).toEqual([]);
});

test('Tu vi: đọc một chương thì tu vi tăng và hiện "Đột phá!" khi lên tầng', async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await registerViaApi(page, baseURL);
  // Hai chương đã đọc (3266 từ, còn thiếu 67 từ tới tầng 2 ở mốc 3334), đang đọc chương 3 có 200 từ
  const bookId = await uploadViaApi(page, baseURL, 'Sach Tu Vi', [1633, 1633, 200]);
  await setProgress(page, baseURL, bookId, 3);

  await page.goto('/'); // lần mở đầu tiên cộng hồi tố 3266 từ
  await expect(page.getByTestId('cultivation-chip')).toContainText('tầng 1');
  await page.getByRole('heading', { name: 'Sach Tu Vi', level: 4 }).click();
  await expect(page.locator('.reader-body')).toContainText('tu tu tu', { timeout: 20_000 });

  await expect(page.getByRole('status').filter({ hasText: 'Đột phá' })).toBeVisible({ timeout: 40_000 });
  expect(await tuVi(page)).toBeGreaterThanOrEqual(3334);
  await page.getByRole('button', { name: /Về thư các|Thư Các|Quay lại/ }).first().click().catch(() => {});
});

test('Tu vi: tắt hệ thống thì ẩn khỏi giao diện, bật lại vẫn còn nguyên tu vi', async ({ page, baseURL }) => {
  await registerViaApi(page, baseURL);
  const bookId = await uploadViaApi(page, baseURL, 'Sach Cong Tat', [800, 800, 200]);
  await setProgress(page, baseURL, bookId, 3);
  await page.goto('/');
  await expect(page.getByTestId('cultivation-chip')).toBeVisible();

  await page.getByRole('heading', { name: 'Sach Cong Tat', level: 4 }).click();
  await expect(page.locator('.reader-body')).toBeVisible({ timeout: 20_000 });
  await page.getByTitle(/Cài đặt giao diện/).click();
  await page.getByLabel('Hệ thống tu tiên').uncheck();
  await expect.poll(async () => (await (await page.request.get('/api/cultivation')).json()).enabled).toBe(false);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sach Cong Tat', level: 4 })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('cultivation-chip')).toHaveCount(0);

  await page.getByRole('heading', { name: 'Sach Cong Tat', level: 4 }).click();
  await expect(page.locator('.reader-body')).toBeVisible({ timeout: 20_000 });
  await page.getByTitle(/Cài đặt giao diện/).click();
  await page.getByLabel('Hệ thống tu tiên').check();
  await expect.poll(async () => (await (await page.request.get('/api/cultivation')).json()).enabled).toBe(true);
  expect(await tuVi(page)).toBeGreaterThanOrEqual(1600);
});

test('Tu vi: đọc khi mất mạng được gom lại và gửi bù khi có mạng', async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);
  await registerViaUi(page);
  const bookId = await uploadViaApi(page, baseURL, 'Sach Offline Tu Vi', [100, 100, 100]);

  await page.reload();
  await page.getByRole('heading', { name: 'Sach Offline Tu Vi', level: 4 }).click();
  await expect(page.locator('.reader-body')).toContainText('tu tu tu', { timeout: 20_000 });
  expect(await tuVi(page)).toBe(0);

  await context.setOffline(true);
  await page.waitForTimeout(13_000); // đọc một lúc khi không có mạng
  // Báo cáo phải nằm trong hàng đợi (chưa gửi được), tu vi trên máy chủ vẫn 0
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('cuu-report-queue') || '[]').length);
  expect(queued).toBeGreaterThan(0);
  await context.setOffline(false);

  await expect.poll(() => tuVi(page), { timeout: 40_000 }).toBeGreaterThan(0);
  void bookId;
});

test('Icon cảnh giới: chip có icon đúng bậc, bấm chip mở bảng đủ 18 bậc và đánh dấu bậc hiện tại', async ({ page }) => {
  const problems = collectProblems(page);
  await registerViaUi(page);
  const chip = page.getByTestId('cultivation-chip');
  await expect(chip.locator('svg[data-icon="Ngưng Khí"]')).toBeVisible();

  await chip.click();
  const dialog = page.getByRole('dialog', { name: 'Con đường tu luyện' });
  await expect(dialog).toBeVisible();
  const rows = dialog.getByTestId('realm-row');
  await expect(rows).toHaveCount(18);

  // Mỗi bậc một icon riêng
  const icons = await rows.locator('svg').evaluateAll((els) => els.map((e) => e.getAttribute('data-icon')));
  expect(new Set(icons).size).toBe(18);
  // ...và hình vẽ thật sự khác nhau, không bậc nào rơi về icon dự phòng
  const drawings = await rows.locator('svg').evaluateAll((els) => els.map((e) => e.innerHTML));
  expect(new Set(drawings).size).toBe(18);
  await expect(dialog.locator('svg[data-fallback]')).toHaveCount(0);

  // Chỉ bậc hiện tại được đánh dấu
  await expect(dialog.locator('[aria-current="true"]')).toHaveCount(1);
  await expect(dialog.locator('[aria-current="true"]')).toContainText('Ngưng Khí');

  // Bước thứ ba có mặt, cảnh giới quá độ có chú thích alias
  await expect(dialog).toContainText('Tam bộ vô biên');
  await expect(dialog).toContainText('Phá Không Ngũ Chỉ');

  await dialog.getByRole('button', { name: 'Đóng' }).click();
  await expect(dialog).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('Tu vi: ngồi yên trên một màn hình không bị cộng lặp mỗi 10 giây', async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await registerViaApi(page, baseURL);
  // Một đoạn 300 từ nằm trọn trên màn hình
  await uploadViaApi(page, baseURL, 'Sach Ngoi Yen', [300]);
  await page.goto('/');
  await page.getByRole('heading', { name: 'Sach Ngoi Yen', level: 4 }).click();
  await expect(page.locator('.reader-body')).toContainText('tu tu tu', { timeout: 20_000 });

  await page.waitForTimeout(40_000); // ngồi yên 40 giây: chỉ được tính đúng một lần 300 từ
  const gained = await tuVi(page);
  expect(gained).toBeGreaterThan(0);
  expect(gained).toBeLessThanOrEqual(300);
});
