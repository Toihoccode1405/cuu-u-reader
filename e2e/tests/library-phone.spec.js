import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { collectProblems, uniqueName, PASSWORD } from './helpers.js';

const SIZES = {
  p320: { width: 320, height: 640 },
  p375: { width: 375, height: 667 },
  p400: { width: 400, height: 600 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
};

async function epub(title, author) {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine></package>`);
  z.file('OEBPS/toc.ncx', '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="n1"><navLabel><text>Chương 88: Đoán Cốt cảnh đỉnh phong</text></navLabel><content src="c1.xhtml"/></navPoint><navPoint id="n2"><navLabel><text>Chương 89: Tiếp</text></navLabel><content src="c2.xhtml"/></navPoint></navMap></ncx>');
  z.file('OEBPS/c1.xhtml', '<html><body><p>tu tu tu tu tu tu</p></body></html>');
  z.file('OEBPS/c2.xhtml', '<html><body><p>tu tu tu tu tu tu</p></body></html>');
  return Buffer.from(await z.generateAsync({ type: 'uint8array' }));
}

async function setup(page, baseURL, size, title) {
  await page.setViewportSize(size);
  await page.request.post('/api/auth/register', { headers: { Origin: baseURL }, data: { username: uniqueName(), password: PASSWORD } });
  const up = await page.request.post('/api/books/upload', {
    headers: { Origin: baseURL },
    multipart: { file: { name: 'l.epub', mimeType: 'application/epub+zip', buffer: await epub(title, 'zalo 0704730588 và một tên tác giả rất dài dòng') } },
  });
  expect(up.ok()).toBe(true);
  const { id } = await up.json();
  await page.request.post(`/api/books/${id}/progress`, { headers: { Origin: baseURL }, data: { chapter_index: 2, scroll_percent: 3, para_index: 0, chapter_title: 'Chương 88: Đoán Cốt cảnh đỉnh phong', book_title: title } });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: title, level: 4 }).first()).toBeVisible({ timeout: 20_000 });
}

for (const [name, size] of Object.entries(SIZES)) {
  test(`Thư viện (${name} ${size.width}px): header gọn không tràn, thẻ sách không bẻ dòng`, async ({ page, baseURL }) => {
    const problems = collectProblems(page);
    await setup(page, baseURL, size, `Sach Thu Vien ${name}`);
    const phone = size.width <= 640;

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const header = page.locator('header.header');
    const hb = await header.boundingBox();
    if (phone) expect(hb.height).toBeLessThanOrEqual(64);

    // Logo không bị bẻ dòng; điện thoại chỉ còn con dấu
    const brand = page.locator('.brand');
    expect((await brand.boundingBox()).height).toBeLessThanOrEqual(48);
    if (phone) await expect(page.locator('.brand-text')).toBeHidden();
    else await expect(page.locator('.brand-text')).toBeVisible();

    // Mọi nút trong header nằm trong màn hình
    for (const b of await header.locator('button:visible, label:visible, input:visible').all()) {
      const box = await b.boundingBox();
      if (!box) continue;
      expect(box.x).toBeGreaterThanOrEqual(-0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);
    }

    await expect(page.getByTestId('cultivation-chip')).toBeVisible();
    await expect(page.getByTestId('cultivation-chip')).toContainText('tầng 1');
    await expect(page.locator('label[title="Thêm sách EPUB"]')).toBeVisible();

    if (phone) {
      // Tìm kiếm: nút kính lúp bấm ra ô nhập
      const input = page.getByPlaceholder('Tìm kiếm sách, tác giả...');
      await expect(input).toBeHidden();
      await page.getByRole('button', { name: 'Tìm kiếm' }).click();
      await expect(input).toBeVisible();
      const ib = await input.boundingBox();
      expect(ib.x + ib.width).toBeLessThanOrEqual(size.width);
      expect(ib.width).toBeGreaterThanOrEqual(size.width - 80);
      await input.fill('zzzkhongco');
      await page.getByRole('button', { name: 'Đóng tìm kiếm' }).click();
      await expect(input).toBeHidden();

      // Tài khoản gộp vào menu
      await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Tài khoản' }).click();
      const menu = page.getByRole('menu', { name: 'Tài khoản' });
      await expect(menu.getByRole('menuitem', { name: 'Đăng xuất', exact: true })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Đăng xuất mọi thiết bị' })).toBeVisible();
      const mb = await menu.boundingBox();
      expect(mb.x).toBeGreaterThanOrEqual(0);
      expect(mb.x + mb.width).toBeLessThanOrEqual(size.width);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    } else {
      await expect(page.getByPlaceholder('Tìm kiếm sách, tác giả...')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Tài khoản' })).toHaveCount(0);
    }

    // Thẻ lịch sử: "Đọc tiếp" một dòng, dòng tác giả không bẻ
    const resume = page.locator('.history-resume-btn').first();
    await expect(resume).toBeVisible();
    expect((await resume.boundingBox()).height).toBeLessThanOrEqual(40);
    const meta = page.locator('.history-meta-text').first();
    expect((await meta.boundingBox()).height).toBeLessThanOrEqual(22);
    expect(problems).toEqual([]);
  });
}
