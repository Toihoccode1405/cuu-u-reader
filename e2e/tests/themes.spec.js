import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { uniqueName, PASSWORD } from './helpers.js';

async function epub(title) {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="c1"/></spine></package>`);
  z.file('OEBPS/toc.ncx', '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="n1"><navLabel><text>Chương 1: Tiệm Nhỏ</text></navLabel><content src="c1.xhtml"/></navPoint></navMap></ncx>');
  z.file('OEBPS/c1.xhtml', '<html><body><p>tu tu tu tu tu tu</p><p>tu tu tu tu tu tu</p></body></html>');
  return Buffer.from(await z.generateAsync({ type: 'uint8array' }));
}

async function open(page, baseURL, title, savedTheme) {
  if (savedTheme) {
    await page.addInitScript((t) => localStorage.setItem('cuu_u_reader_settings', JSON.stringify({ uiv: 2, theme: t, font: 'font-literata', fontSize: 20, lineHeight: 1.8, letterSpacing: 0, maxWidth: 760, justify: true, indent: true, allowSelect: false })), savedTheme);
  }
  await page.request.post('/api/auth/register', { headers: { Origin: baseURL }, data: { username: uniqueName(), password: PASSWORD } });
  await page.request.post('/api/books/upload', { headers: { Origin: baseURL }, multipart: { file: { name: 't.epub', mimeType: 'application/epub+zip', buffer: await epub(title) } } });
  await page.goto('/');
  await page.getByRole('heading', { name: title, level: 4 }).click();
  await expect(page.locator('.reader-body')).toContainText('tu tu', { timeout: 20_000 });
}

const colors = async (page) => {
  await page.waitForTimeout(500); // chờ hiệu ứng chuyển màu
  return readColors(page);
};
const readColors = (page) => page.evaluate(() => {
  const dc = getComputedStyle(document.querySelector('.reader-body [data-p="0"]'), '::first-letter').color;
  return {
    card: getComputedStyle(document.querySelector('.reader-card')).backgroundColor,
    page: getComputedStyle(document.body).backgroundColor,
    title: getComputedStyle(document.querySelector('.chapter-head-title')).color,
    dropcap: dc,
    header: getComputedStyle(document.querySelector('.reader-header')).backgroundColor,
  };
});

test('Theme: 4 lựa chọn Theo giao diện / Sáng / Sepia / Tối với đúng bảng màu', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page, baseURL, 'Sach Theme');
  await page.getByRole('navigation', { name: 'Điều hướng chương' }).getByRole('button', { name: 'Cài đặt đọc', exact: true }).click();
  const sheet = page.locator('.drawer-overlay.open .drawer');
  for (const t of ['Theo giao diện', 'Sáng', 'Sepia', 'Tối']) await expect(sheet.getByRole('button', { name: t, exact: true })).toBeVisible();
  // Các chủ đề cũ đã bị bỏ
  for (const t of ['Bạch Ngọc', 'Huyền Thiết', 'U Minh', 'Thanh Liên', 'Mặc Họa']) await expect(sheet.getByText(t, { exact: true })).toHaveCount(0);

  await sheet.getByRole('button', { name: 'Sepia', exact: true }).click();
  let c = await colors(page);
  expect(c.card).toBe('rgb(244, 236, 216)');
  expect(c.title).toBe('rgb(67, 52, 34)');
  expect(c.dropcap).toBe('rgb(181, 55, 20)');
  expect(c.header).toContain('244, 236, 216');

  await sheet.getByRole('button', { name: 'Tối', exact: true }).click();
  c = await colors(page);
  expect(c.card).toBe('rgb(22, 22, 24)');
  expect(c.page).toBe('rgb(11, 11, 12)');
  expect(c.title).toBe('rgb(244, 244, 245)');
  expect(c.dropcap).toBe('rgb(255, 107, 71)');
  expect(c.header).toContain('22, 22, 24');

  await sheet.getByRole('button', { name: 'Sáng', exact: true }).click();
  c = await colors(page);
  expect(c.card).toBe('rgb(255, 255, 255)');
  expect(c.title).toBe('rgb(24, 24, 27)');
  expect(c.dropcap).toBe('rgb(201, 65, 25)');
});

test('Theme: "Theo giao diện" đi theo hệ điều hành; chủ đề cũ được chuyển sang Sáng/Tối', async ({ page, baseURL, browser }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page, baseURL, 'Sach Auto', 'auto');
  expect((await colors(page)).card).toBe('rgb(22, 22, 24)');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(async () => (await colors(page)).card).toBe('rgb(255, 255, 255)');

  const c2 = await browser.newContext({ baseURL, colorScheme: 'light' });
  const p2 = await c2.newPage();
  await open(p2, baseURL, 'Sach Cu Oled', 'oled'); // U Minh -> Tối
  expect((await colors(p2)).card).toBe('rgb(22, 22, 24)');
  const c3 = await browser.newContext({ baseURL, colorScheme: 'light' });
  const p3 = await c3.newPage();
  await open(p3, baseURL, 'Sach Cu Jade', 'jade'); // Thanh Liên -> Sáng
  expect((await colors(p3)).card).toBe('rgb(255, 255, 255)');
});
