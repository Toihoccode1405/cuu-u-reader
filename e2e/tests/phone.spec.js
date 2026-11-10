import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { collectProblems, uniqueName, PASSWORD } from './helpers.js';

const P = 'Phương Nguyên thản nhiên đối mắt với y, vẻ mặt dửng dưng, không hề sợ hãi. Ánh mắt Giang Nha loé lên, không khí lạnh lẽo dần dần biến mất, y cảm nhận được khí tức Chân nguyên trên người Phương Nguyên.';

async function epub(title) {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="c1"/></spine></package>`);
  z.file('OEBPS/toc.ncx', '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="n1"><navLabel><text>Chương 12: Phương Nguyên, Cự Dương chiến Tinh Túc</text></navLabel><content src="c1.xhtml"/></navPoint></navMap></ncx>');
  z.file('OEBPS/c1.xhtml', `<html><body>${Array.from({ length: 40 }, () => `<p>${P}</p>`).join('')}</body></html>`);
  return Buffer.from(await z.generateAsync({ type: 'uint8array' }));
}

async function open(page, baseURL, title, size) {
  await page.setViewportSize(size);
  await page.request.post('/api/auth/register', { headers: { Origin: baseURL }, data: { username: uniqueName(), password: PASSWORD } });
  await page.request.post('/api/books/upload', { headers: { Origin: baseURL }, multipart: { file: { name: 'p.epub', mimeType: 'application/epub+zip', buffer: await epub(title) } } });
  await page.goto('/');
  await page.getByRole('heading', { name: title, level: 4 }).click();
  await expect(page.locator('.reader-body')).toContainText('Phương Nguyên', { timeout: 20_000 });
  await page.waitForTimeout(2800); // qua khoảng yên lặng sau khi mở chương
}

const PHONE = { width: 360, height: 640 };

test('Điện thoại: lề gọn, tiêu đề vừa phải, đoạn đầu lên sớm, đoạn 0 không bị bôi sáng', async ({ page, baseURL }) => {
  const problems = collectProblems(page);
  await open(page, baseURL, 'Sach Dien Thoai', PHONE);

  const m = await page.evaluate(() => {
    const p = document.querySelector('.reader-body [data-p="1"]') || document.querySelector('.reader-body [data-p="0"]');
    const p0 = document.querySelector('.reader-body [data-p="0"]');
    const card = getComputedStyle(document.querySelector('.reader-card'));
    return {
      align: getComputedStyle(p).textAlign,
      padL: parseFloat(card.paddingLeft),
      h1: parseFloat(getComputedStyle(document.querySelector('.chapter-head-title')).fontSize),
      firstTop: p0.getBoundingClientRect().top,
      p0Class: p0.className,
    };
  });
  expect(m.padL).toBeLessThanOrEqual(16);
  expect(m.h1).toBeLessThanOrEqual(30);
  expect(m.firstTop).toBeLessThanOrEqual(330);
  expect(m.p0Class).not.toMatch(/highlight|focused|bookmarked/);
  expect(problems).toEqual([]);
});

test('Máy tính bảng vẫn căn đều hai bên theo cài đặt', async ({ page, baseURL }) => {
  await open(page, baseURL, 'Sach Tablet Can Deu', { width: 768, height: 1024 });
  const align = await page.evaluate(() => getComputedStyle(document.querySelector('.reader-body [data-p="1"]')).textAlign);
  expect(align).toBe('justify');
});

test('Điện thoại: thanh nút nổi ẩn khi cuộn xuống, hiện khi cuộn ngược dài hoặc gần cuối chương', async ({ page, baseURL }) => {
  await open(page, baseURL, 'Sach Pill An Hien', PHONE);
  const nav = page.getByRole('navigation', { name: 'Điều hướng chương' });
  const scrollTo = async (y) => { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(300); };
  await expect(nav).toBeVisible();
  await scrollTo(400);
  await scrollTo(1400);
  await expect(page.locator('.reader-header')).toHaveClass(/hidden/);
  await expect(nav).toBeHidden();

  await scrollTo(1250); // lên 150px: hiện lại
  await expect(nav).toBeVisible();

  await scrollTo(1500);
  await expect(nav).toBeHidden();
  const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  await scrollTo(max); // tới cuối chương: phải còn nút Chương sau
  await expect(nav).toBeVisible();
});

test('Điện thoại: menu ⋯ gọn, không có Phím tắt, mỗi mục một dòng', async ({ page, baseURL }) => {
  await open(page, baseURL, 'Sach Menu Dien Thoai', PHONE);
  await page.getByRole('button', { name: 'Thêm chức năng' }).click();
  const menu = page.getByRole('menu', { name: 'Thêm chức năng' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Phím tắt/ })).toHaveCount(0);
  for (const item of await menu.getByRole('menuitem').all()) {
    const box = await item.boundingBox();
    expect(box.height).toBeLessThanOrEqual(52);
  }
  const mb = await menu.boundingBox();
  expect(mb.x).toBeGreaterThanOrEqual(0);
  expect(mb.x + mb.width).toBeLessThanOrEqual(PHONE.width);
});

test('Đoạn được bôi sáng/ghim: vạch màu nằm trong lề, không dính vào chữ (điện thoại và máy lớn)', async ({ page, baseURL }) => {
  await open(page, baseURL, 'Sach Vach Mau', PHONE);
  const measure = () => page.evaluate(() => {
    const p = document.querySelector('.reader-body [data-p="2"]');
    const before = p.getBoundingClientRect().left;
    p.classList.add('focused-line');
    const c = getComputedStyle(p);
    const r = p.getBoundingClientRect();
    // chữ bắt đầu cách mép dải sáng bao nhiêu px
    const range = document.createRange();
    range.selectNodeContents(p);
    const textLeft = range.getBoundingClientRect().left;
    return { padL: parseFloat(c.paddingLeft), gap: textLeft - r.left, left: r.left, cardLeft: document.querySelector('.reader-card').getBoundingClientRect().left, before };
  });
  let m = await measure();
  expect(m.padL).toBeGreaterThanOrEqual(12); // chữ cách vạch/mép dải sáng ít nhất 12px
  expect(m.gap).toBeGreaterThanOrEqual(12);
  expect(m.left).toBeGreaterThanOrEqual(m.cardLeft - 1); // dải sáng không tràn ra ngoài thẻ

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
  m = await measure();
  expect(m.gap).toBeGreaterThanOrEqual(12);
  expect(m.left).toBeGreaterThanOrEqual(m.cardLeft - 1);
});

const gaps = (page) => page.evaluate(() => {
  const widths = [];
  for (const p of document.querySelectorAll('.reader-body [data-p]')) {
    const node = p.firstChild;
    if (!node || node.nodeType !== 3) continue;
    const t = node.textContent;
    for (let i = 0; i < t.length; i++) {
      if (t[i] !== ' ') continue;
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      const rects = r.getClientRects();
      if (rects.length === 1 && rects[0].width > 0.5) widths.push(rects[0].width);
    }
  }
  widths.sort((a, b) => a - b);
  return { n: widths.length, p50: widths[Math.floor(widths.length * 0.5)], p90: widths[Math.floor(widths.length * 0.9)], max: widths[widths.length - 1] };
});

test('Điện thoại: nút Căn đều/Căn trái hoạt động; mặc định căn đều, chữ 18px, khe giữa các từ không hở quá', async ({ page, baseURL }) => {
  await open(page, baseURL, 'Sach Can Deu Dien Thoai', PHONE);
  const read = () => page.evaluate(() => {
    const p = document.querySelector('.reader-body [data-p="1"]');
    const c = getComputedStyle(p);
    return { align: c.textAlign, fs: parseFloat(c.fontSize), lh: parseFloat(c.lineHeight) };
  });
  let r = await read();
  expect(r.align).toBe('justify');
  expect(r.fs).toBe(18);
  expect(r.lh).toBeCloseTo(32.4, 1);

  const g = await gaps(page);
  expect(g.n).toBeGreaterThan(50);
  expect(g.p90).toBeLessThanOrEqual(12); // 90% khe không quá ~2,5 lần khe thường (≈4,5px)

  await page.getByRole('navigation', { name: 'Điều hướng chương' }).getByRole('button', { name: 'Cài đặt đọc', exact: true }).click();
  const sheet = page.locator('.drawer-overlay.open .drawer');
  await sheet.getByRole('button', { name: 'Căn Trái', exact: true }).click();
  await page.waitForTimeout(300);
  expect((await read()).align).toBe('left');
  await sheet.getByRole('button', { name: 'Căn Đều 2 Bên', exact: true }).click();
  await page.waitForTimeout(300);
  expect((await read()).align).toBe('justify');
});
