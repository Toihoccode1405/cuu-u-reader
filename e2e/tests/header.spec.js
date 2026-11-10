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

const INLINE_ALWAYS = ['Cắm cờ tại dòng đang đọc (F)', 'Mục lục chương (C)', 'Cài đặt giao diện (S)'];
const MENU_ITEMS_PHONE = ['Ghim sáng dòng đang đọc (H)', 'Danh sách cờ đã cắm (M)', 'Tải file EPUB về máy', 'Sửa nội dung chương (E)'];

for (const [name, size] of Object.entries(VIEWPORTS)) {
  test(`Thanh công cụ (${name} ${size.width}px): không tràn ngang, nút chính bấm được, tên chương còn thấy`, async ({ page, baseURL }) => {
    const problems = collectProblems(page);
    await page.setViewportSize(size);
    await openBook(page, baseURL, `Sach Header ${name}`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const header = page.locator('.reader-header');
    const h = (await header.boundingBox()).height;
    if (name === 'phone') expect(h).toBeLessThanOrEqual(48);
    if (name === 'tablet') expect(h).toBeLessThanOrEqual(56);

    for (const t of INLINE_ALWAYS) await expect(btn(page, t)).toBeVisible();
    await expect(page.locator('.header-chapter-title')).toBeVisible();
    const titleBox = await page.locator('.header-chapter-title').boundingBox();
    expect(titleBox.width).toBeGreaterThanOrEqual(name === 'phone' ? 90 : 150);

    // Mọi nút nằm trong màn hình
    for (const b of await header.getByRole('button').all()) {
      if (!(await b.isVisible())) continue;
      const box = await b.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);
    }

    const more = btn(page, 'Thêm chức năng');
    if (name === 'desktop') {
      await expect(more).toHaveCount(0);
      for (const t of [...MENU_ITEMS_PHONE, 'Phím tắt (?)', 'Toàn màn hình']) await expect(btn(page, t)).toBeVisible();
    } else {
      await expect(more).toBeVisible();
      // Nút phụ không nằm ngoài thanh nữa mà nằm trong menu
      for (const t of MENU_ITEMS_PHONE) await expect(header.getByRole('button', { name: t })).toHaveCount(0);
      await more.click();
      const menu = page.getByRole('menu', { name: 'Thêm chức năng' });
      await expect(menu).toBeVisible();
      for (const t of MENU_ITEMS_PHONE) await expect(menu.getByRole('menuitem', { name: t })).toBeVisible();
      await menu.getByRole('menuitem', { name: 'Danh sách cờ đã cắm (M)' }).click();
      await expect(page.locator('.drawer-overlay.open')).toHaveCount(1);
      await expect(menu).toHaveCount(0); // bấm xong menu tự đóng
    }
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
