import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { collectProblems, uniqueName, PASSWORD } from './helpers.js';

const VIEWPORTS = {
  phone: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
};

const words = (n) => Array(n).fill('tu').join(' ');

async function epub(title) {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>Tac Gia</dc:creator></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine></package>`);
  z.file('OEBPS/toc.ncx', '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="n1"><navLabel><text>Chương 1: Tiệm Nhỏ</text></navLabel><content src="c1.xhtml"/></navPoint><navPoint id="n2"><navLabel><text>Chương 2: Khách Lạ</text></navLabel><content src="c2.xhtml"/></navPoint></navMap></ncx>');
  const paras = Array.from({ length: 30 }, () => `<p>${words(40)}</p>`).join('');
  z.file('OEBPS/c1.xhtml', `<html><body>${paras}</body></html>`);
  z.file('OEBPS/c2.xhtml', `<html><body><p>${words(40)}</p><p>${words(40)}</p></body></html>`);
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
    multipart: { file: { name: 's.epub', mimeType: 'application/epub+zip', buffer: await epub(title) } },
  });
  expect(up.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('heading', { name: title, level: 4 }).click();
  await expect(page.locator('.reader-body')).toContainText('tu tu tu', { timeout: 20_000 });
}

const px = (s) => parseFloat(s);

for (const [name, size] of Object.entries(VIEWPORTS)) {
  test(`Giao diện đọc (${name}): đầu chương, drop cap, khung, thanh nổi`, async ({ page, baseURL }) => {
    const problems = collectProblems(page);
    await page.setViewportSize(size);
    await openBook(page, baseURL, `Sach Mat Doc ${name}`);

    // Đầu chương: dòng nhỏ "CHƯƠNG 1", tiêu đề không lặp số chương, vạch kẻ, tên truyện
    const head = page.locator('.chapter-head');
    await expect(head.locator('.chapter-eyebrow')).toHaveText(/^CHƯƠNG 1$/);
    await expect(head.getByRole('heading', { level: 1 })).toHaveText('Tiệm Nhỏ');
    await expect(head.locator('.chapter-divider')).toBeVisible();
    await expect(head.locator('.chapter-meta')).toContainText(`Sach Mat Doc ${name}`);
    const h1 = await head.getByRole('heading', { level: 1 }).evaluate((e) => {
      const c = getComputedStyle(e);
      return { ff: c.fontFamily, fw: c.fontWeight, ta: c.textAlign };
    });
    expect(h1.ta).toBe('center');
    expect(Number(h1.fw)).toBeGreaterThanOrEqual(600);
    expect(h1.ff).toContain('Literata');

    // Drop cap: chữ cái đầu nổi trái, to gấp ~3,4 lần
    const dc = await page.evaluate(() => {
      const p = document.querySelector('.reader-body [data-p="0"]');
      const c = getComputedStyle(p, '::first-letter');
      return { fl: c.float, size: c.fontSize, color: c.color, base: getComputedStyle(p).fontSize };
    });
    expect(dc.fl).toBe('left');
    expect(px(dc.size) / px(dc.base)).toBeGreaterThan(2.5);

    // Khung thẻ: từ 641px trở lên là thẻ bo góc có viền, rộng tối đa 760px; điện thoại thì tràn màn hình
    const card = await page.locator('.reader-card').evaluate((e) => {
      const c = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return { w: r.width, radius: c.borderTopLeftRadius, border: c.borderTopWidth, bg: c.backgroundColor };
    });
    if (name === 'phone') {
      expect(card.w).toBeGreaterThanOrEqual(size.width - 1);
    } else {
      expect(card.w).toBeLessThanOrEqual(761);
      expect(px(card.radius)).toBeGreaterThanOrEqual(12);
      expect(px(card.border)).toBeGreaterThan(0);
    }
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    if (name !== 'phone') expect(card.bg).not.toBe(bodyBg);

    // Cỡ chữ mặc định 20px, giãn dòng 1,8 (người dùng mới)
    const t = await page.locator('.reader-body').evaluate((e) => {
      const p = e.querySelector('[data-p="1"]');
      const c = getComputedStyle(p);
      return { fs: c.fontSize, lh: c.lineHeight };
    });
    expect(px(t.fs)).toBe(20);
    expect(px(t.lh)).toBe(36);

    // Thanh nổi: Chương trước | n / tổng | Aa | Chương sau
    const nav = page.getByRole('navigation', { name: 'Điều hướng chương' });
    await expect(nav).toBeVisible();
    const nb = await nav.boundingBox();
    expect(nb.y + nb.height).toBeLessThanOrEqual(size.height);
    expect(nb.y + nb.height).toBeGreaterThan(size.height - 40);
    expect(Math.abs(nb.x + nb.width / 2 - size.width / 2)).toBeLessThan(2);
    await expect(nav.getByRole('button', { name: 'Chương trước', exact: true })).toBeDisabled();
    await expect(nav.getByRole('button', { name: /^1 \/ 2$/ })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Cài đặt đọc', exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Thanh nổi vẫn còn khi cuộn
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(300);
    await expect(nav).toBeVisible();

    // n / tổng mở mục lục
    await nav.getByRole('button', { name: /^1 \/ 2$/ }).click();
    await expect(page.locator('.drawer-overlay.open')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.drawer-overlay.open')).toHaveCount(0);

    // Aa mở bảng cài đặt: điện thoại là tấm trượt từ dưới lên
    await nav.getByRole('button', { name: 'Cài đặt đọc', exact: true }).click();
    const sheet = page.locator('.drawer-overlay.open .drawer');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(500);
    const sb = await sheet.boundingBox();
    if (name === 'phone') {
      expect(sb.width).toBeGreaterThanOrEqual(size.width - 1);
      expect(sb.y + sb.height).toBeGreaterThanOrEqual(size.height - 1);
      expect(sb.y).toBeGreaterThan(size.height * 0.25); // không phủ kín màn hình
    }
    await page.locator('.drawer-overlay.open').click({ position: { x: 5, y: 5 } });

    // Chương sau: sang chương 2, thanh nổi cập nhật và "Chương trước" bật lại
    await nav.getByRole('button', { name: 'Chương sau', exact: true }).click();
    await expect(page.locator('.chapter-head .chapter-eyebrow')).toHaveText('CHƯƠNG 2');
    await expect(page.locator('.chapter-head').getByRole('heading', { level: 1 })).toHaveText('Khách Lạ');
    await expect(nav.getByRole('button', { name: /^2 \/ 2$/ })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Chương sau', exact: true })).toBeDisabled();
    await expect(nav.getByRole('button', { name: 'Chương trước', exact: true })).toBeEnabled();

    expect(problems).toEqual([]);
  });
}

test('Giãn dòng: chỉnh khoảng cách giữa các đoạn, dòng trong một đoạn giữ nguyên', async ({ page, baseURL }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await openBook(page, baseURL, 'Sach Gian Dong');
  const measure = () => page.evaluate(() => {
    const a = document.querySelector('.reader-body [data-p="1"]');
    const b = document.querySelector('.reader-body [data-p="2"]');
    return {
      gap: b.getBoundingClientRect().top - a.getBoundingClientRect().bottom,
      lh: parseFloat(getComputedStyle(a).lineHeight),
    };
  });
  const before = await measure();
  expect(before.lh).toBe(36);

  await page.getByRole('navigation', { name: 'Điều hướng chương' }).getByRole('button', { name: 'Cài đặt đọc', exact: true }).click();
  const range = page.locator('.drawer-overlay.open input[type="range"][min="1.2"]');
  await range.evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '2.4');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const after = await measure();
  expect(after.lh).toBe(36); // dòng trong đoạn không đổi
  expect(after.gap).toBeGreaterThan(before.gap + 10); // khoảng cách giữa các đoạn rộng ra
});

test('Thanh tiến độ không để lại vệt ở mép trên khi thanh đầu đã ẩn', async ({ page, baseURL }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await openBook(page, baseURL, 'Sach Vet Tien Do');
  await page.waitForTimeout(2800);
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect(page.locator('.reader-header')).toHaveClass(/hidden/);
  await page.waitForTimeout(500);
  const bar = await page.locator('.header-progress').boundingBox();
  expect(bar.y + bar.height).toBeLessThanOrEqual(0.5); // nằm hẳn ngoài màn hình
});

test('Thanh tiến độ chạy theo cuộn và tự cập nhật khi chiều cao trang đổi (không cần cuộn)', async ({ page, baseURL }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await openBook(page, baseURL, 'Sach Tien Do Chay');
  await page.waitForTimeout(2800);
  const scale = () => page.locator('.header-progress').evaluate((e) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(e).transform);
    return m.a;
  });
  await page.evaluate(() => window.scrollTo(0, 800));
  await expect.poll(scale).toBeGreaterThan(0.05);
  const s1 = await scale();
  await page.evaluate(() => window.scrollTo(0, 1600));
  await expect.poll(scale).toBeGreaterThan(s1 + 0.05);
  // Trang dài thêm (ví dụ phông chữ/hình tải xong): tiến độ phải co lại theo mà không cần cuộn
  const s2 = await scale();
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.height = '6000px';
    document.querySelector('.reader-card').appendChild(d);
  });
  await expect.poll(scale).toBeLessThan(s2 - 0.1);
});

test('Mục lục chỉ được dựng khi mở (truyện nghìn chương không bị nặng mỗi lần cuộn)', async ({ page, baseURL }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await openBook(page, baseURL, 'Sach Muc Luc Nhe');
  await expect(page.locator('.toc-item')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Điều hướng chương' }).getByRole('button', { name: /^1 \/ 2$/ }).click();
  await expect(page.locator('.toc-item')).toHaveCount(2);
  await expect(page.locator('.toc-item.active')).toContainText('Tiệm Nhỏ');
  await page.keyboard.press('Escape');
  await expect(page.locator('.toc-item')).toHaveCount(0);
});
