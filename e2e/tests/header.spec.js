import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { collectProblems, uniqueName, PASSWORD } from './helpers.js';

const VIEWPORTS = {
  phone: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
};

const words = (n) => Array(n).fill('tu').join(' ');

// Chương dài (nhiều đoạn) để cuộn được
async function longEpub(title) {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>Tac Gia</dc:creator></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine></package>`);
  z.file('OEBPS/toc.ncx', '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="n1"><navLabel><text>Chuong mot dai dong de thu ten chuong</text></navLabel><content src="c1.xhtml"/></navPoint><navPoint id="n2"><navLabel><text>Chuong hai</text></navLabel><content src="c2.xhtml"/></navPoint></navMap></ncx>');
  const paras = Array.from({ length: 80 }, () => `<p>${words(40)}</p>`).join('');
  z.file('OEBPS/c1.xhtml', `<html><body>${paras}</body></html>`);
  z.file('OEBPS/c2.xhtml', `<html><body><p>${words(40)}</p></body></html>`);
  return Buffer.from(await z.generateAsync({ type: 'uint8array' }));
}

async function openBook(page, baseURL, title) {
  const reg = await page.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: { username: uniqueName(), password: PASSWORD },
  });
  expect(reg.ok()).toBe(true);
  const up = await page.request.post('/api/books/upload', {
    headers: { Origin: baseURL },
    multipart: { file: { name: 'dai.epub', mimeType: 'application/epub+zip', buffer: await longEpub(title) } },
  });
  expect(up.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('heading', { name: title, level: 4 }).click();
  await expect(page.locator('.reader-body')).toContainText('tu tu tu', { timeout: 20_000 });
}

const btn = (page, title) => page.getByRole('button', { name: title });

const INLINE_ALWAYS = ['Quay lại Thư viện', 'Mục lục chương (C)', 'Cài đặt giao diện (S)', 'Thêm chức năng'];
const MENU_ITEMS = ['Ghim sáng dòng đang đọc (H)', 'Cắm cờ tại dòng đang đọc (F)', 'Danh sách cờ đã cắm (M)', 'Phím tắt (?)', 'Tải file EPUB về máy', 'Sửa nội dung chương (E)', 'Toàn màn hình'];

for (const [name, size] of Object.entries(VIEWPORTS)) {
  test(`Thanh công cụ (${name} ${size.width}px): gọn, tên truyện còn thấy, mọi chức năng nằm trong menu ⋯`, async ({ page, baseURL }) => {
    const problems = collectProblems(page);
    await page.setViewportSize(size);
    await openBook(page, baseURL, `Sach Header ${name}`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const header = page.locator('.reader-header');
    const h = (await header.boundingBox()).height;
    expect(h).toBeLessThanOrEqual(60);
    expect(h).toBeGreaterThanOrEqual(52);

    for (const t of INLINE_ALWAYS) await expect(header.getByRole('button', { name: t })).toBeVisible();
    // Chỉ còn 4 nút: quay lại, mục lục, Aa, ⋯
    expect(await header.getByRole('button').count()).toBe(4);

    const title = header.locator('.header-book-title');
    await expect(title).toBeVisible();
    await expect(title).toHaveText(`Sach Header ${name}`);
    expect((await title.boundingBox()).width).toBeGreaterThanOrEqual(name === 'phone' ? 100 : 200);

    // Chữ "Chương n" cạnh nút mục lục chỉ hiện từ máy tính bảng
    const toc = header.getByRole('button', { name: 'Mục lục chương (C)' });
    if (name === 'phone') await expect(toc.locator('.toc-label')).toBeHidden();
    else await expect(toc.locator('.toc-label')).toHaveText('Chương 1');

    // Thanh tiến độ 2px dính đáy thanh
    const bar = header.locator('.header-progress');
    await expect(bar).toBeAttached();
    expect((await bar.boundingBox()).height).toBeLessThanOrEqual(3);

    for (const b of await header.getByRole('button').all()) {
      const box = await b.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);
    }

    await header.getByRole('button', { name: 'Thêm chức năng' }).click();
    const menu = page.getByRole('menu', { name: 'Thêm chức năng' });
    await expect(menu).toBeVisible();
    for (const t of MENU_ITEMS) await expect(menu.getByRole('menuitem', { name: t })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Danh sách cờ đã cắm (M)' }).click();
    await expect(page.locator('.drawer-overlay.open')).toHaveCount(1);
    await expect(menu).toHaveCount(0);
    expect(problems).toEqual([]);
  });
}

test('Thanh công cụ (phone): cuộn xuống thì ẩn, cuộn ngược ngắn thì KHÔNG hiện, cuộn ngược dài hoặc bấm nút nhỏ thì hiện', async ({ page, baseURL }) => {
  await page.setViewportSize(VIEWPORTS.phone);
  await openBook(page, baseURL, 'Sach Header Cuon');
  const header = page.locator('.reader-header');
  await page.waitForTimeout(2800); // qua khoảng "yên lặng" sau khi mở chương (cuộn tự động về chỗ đọc dở không ẩn thanh)
  const scrollTo = async (y) => {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(250);
  };

  await expect(header).not.toHaveClass(/hidden/);
  await scrollTo(400);
  await scrollTo(1200);
  await expect(header).toHaveClass(/hidden/);

  await scrollTo(1140); // lên 60px: vẫn ẩn
  await expect(header).toHaveClass(/hidden/);
  await scrollTo(1090); // tổng lên 110px: vẫn ẩn
  await expect(header).toHaveClass(/hidden/);

  await scrollTo(900); // tổng lên 300px: hiện
  await expect(header).not.toHaveClass(/hidden/);

  // Ẩn lại rồi dùng nút nhỏ ở mép trên để hiện
  await scrollTo(1500);
  await expect(header).toHaveClass(/hidden/);
  await page.getByRole('button', { name: 'Hiện thanh công cụ' }).click();
  await expect(header).not.toHaveClass(/hidden/);
});
