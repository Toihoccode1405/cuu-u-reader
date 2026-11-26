import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { collectProblems, uniqueName, PASSWORD } from './helpers.js';
import { solidPng } from './helpers-img.js';

const P = 'Vương Lâm ngồi bên con lộ nhỏ dẫn vào thôn, vẻ mặt ngơ ngác nhìn lên bầu trời xanh thắm. Thuở nhỏ thân thể hắn vốn gầy gò ốm yếu, cha hắn sợ khó nuôi được nên theo tập tục mà đặt tên cúng cơm cho hắn là Thiết Trụ.';
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 375, height: 700 };
const RED = [220, 30, 30];
const BLUE = [30, 30, 220];

async function epub(title) {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="c1"/></spine></package>`);
  z.file('OEBPS/toc.ncx', '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="n1"><navLabel><text>Chương 1: Xa nhà</text></navLabel><content src="c1.xhtml"/></navPoint></navMap></ncx>');
  z.file('OEBPS/c1.xhtml', `<html><body>${Array.from({ length: 20 }, () => `<p>${P}</p>`).join('')}</body></html>`);
  return Buffer.from(await z.generateAsync({ type: 'uint8array' }));
}

async function open(page, baseURL, title, size) {
  await page.setViewportSize(size);
  await page.request.post('/api/auth/register', { headers: { Origin: baseURL }, data: { username: uniqueName(), password: PASSWORD } });
  await page.request.post('/api/books/upload', { headers: { Origin: baseURL }, multipart: { file: { name: 'a.epub', mimeType: 'application/epub+zip', buffer: await epub(title) } } });
  await page.goto('/');
  await page.getByRole('heading', { name: title, level: 4 }).click();
  await expect(page.locator('.reader-body')).toContainText('Vương Lâm', { timeout: 20_000 });
}

const bg = (page) => page.getByTestId('reader-bg');
const bgImage = (page) => bg(page).evaluate((el) => getComputedStyle(el).backgroundImage);

async function openSettings(page) {
  if ((page.viewportSize()?.width ?? 1000) <= 640) {
    await page.getByRole('navigation', { name: 'Điều hướng chương' }).getByRole('button', { name: 'Cài đặt đọc', exact: true }).click();
  } else {
    await page.getByTitle(/Cài đặt giao diện/).click();
  }
}
const closeSettings = (page) => page.keyboard.press('Escape');

async function pick(page, file) {
  await openSettings(page);
  await page.getByLabel('Chọn ảnh từ máy').setInputFiles(file);
}

// Đọc thẳng bản ảnh đã lưu trong IndexedDB (hợp đồng: DB cuu_u_bg, kho img, khóa desktop|phone, giá trị Blob)
const stored = (page, slot) => page.evaluate((s) => new Promise((resolve, reject) => {
  const rq = indexedDB.open('cuu_u_bg');
  rq.onerror = () => reject(rq.error);
  rq.onsuccess = () => {
    const db = rq.result;
    if (!db.objectStoreNames.contains('img')) { resolve(null); return; }
    const g = db.transaction('img').objectStore('img').get(s);
    g.onerror = () => reject(g.error);
    g.onsuccess = async () => {
      const blob = g.result;
      if (!blob) { resolve(null); return; }
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const x = c.getContext('2d');
      x.drawImage(bmp, 0, 0);
      const [r, gg, b] = x.getImageData(Math.floor(bmp.width / 2), Math.floor(bmp.height / 2), 1, 1).data;
      resolve({ type: blob.type, size: blob.size, width: bmp.width, height: bmp.height, rgb: [r, gg, b] });
    };
  };
}), slot);

function watchRequests(page) {
  const got = [];
  page.on('request', (r) => { if (!/^(blob|data):/.test(r.url())) got.push(r.url()); });
  return got;
}

test('Máy tính: chọn ảnh riêng thì thành ảnh nền, thu nhỏ còn <= 2560px, nén WebP, không gọi mạng, giữ sau khi tải lại', async ({ page, baseURL }) => {
  const problems = collectProblems(page);
  await open(page, baseURL, 'Sach Anh Rieng May Tinh', DESKTOP);
  expect(await bgImage(page)).toMatch(/vuong-lam-desktop/);

  await page.waitForTimeout(1500); // chờ đồng bộ cài đặt đầu tiên xong để chỉ đo những gì do việc chọn ảnh gây ra
  const reqs = watchRequests(page);
  await pick(page, { name: 'nen.png', mimeType: 'image/png', buffer: solidPng(3000, 2000, RED) });
  await expect.poll(() => bgImage(page)).toMatch(/^url\("blob:/);
  await page.waitForTimeout(800);
  expect(reqs, reqs.join(' ')).toEqual([]);

  const s = await stored(page, 'desktop');
  expect(s.type).toBe('image/webp');
  expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(2560);
  expect(s.width).toBeGreaterThan(2000); // thu nhỏ vừa đủ, không vỡ
  expect(s.size).toBeLessThan(250_000);
  expect(s.rgb[0]).toBeGreaterThan(180);
  expect(s.rgb[2]).toBeLessThan(80);
  expect(await stored(page, 'phone')).toBeNull(); // ô điện thoại không bị đụng tới

  // Tải lại: vẫn là ảnh riêng, và ảnh Vương Lâm mặc định không bị tải
  const imgs = [];
  page.on('request', (r) => { if (/vuong-lam/.test(r.url())) imgs.push(r.url()); });
  await page.reload();
  await page.getByRole('heading', { name: 'Sach Anh Rieng May Tinh', level: 4 }).click();
  await expect(page.locator('.reader-body')).toContainText('Vương Lâm', { timeout: 20_000 });
  await expect.poll(() => bgImage(page)).toMatch(/^url\("blob:/);
  expect(imgs).toEqual([]);
  expect(problems).toEqual([]);
});

test('Hai ô riêng: ảnh máy tính không dính sang điện thoại và ngược lại', async ({ page, baseURL }) => {
  await open(page, baseURL, 'Sach Hai O Rieng', DESKTOP);
  await pick(page, { name: 'do.png', mimeType: 'image/png', buffer: solidPng(1600, 900, RED) });
  await expect.poll(() => stored(page, 'desktop').then((s) => s?.rgb[0])).toBeGreaterThan(180);
  await closeSettings(page);

  await page.setViewportSize(PHONE); // sang điện thoại: ô điện thoại còn trống thì dùng ảnh mặc định
  await expect.poll(() => bgImage(page)).toMatch(/vuong-lam-phone/);

  await pick(page, { name: 'xanh.png', mimeType: 'image/png', buffer: solidPng(1000, 1800, BLUE) });
  await expect.poll(() => bgImage(page)).toMatch(/^url\("blob:/);
  const ph = await stored(page, 'phone');
  expect(ph.rgb[2]).toBeGreaterThan(180);
  expect(Math.max(ph.width, ph.height)).toBeLessThanOrEqual(1440);
  expect((await stored(page, 'desktop')).rgb[0]).toBeGreaterThan(180); // ảnh đỏ máy tính còn nguyên
  await closeSettings(page);

  await page.setViewportSize(DESKTOP); // quay lại máy tính: ảnh đỏ, không phải ảnh xanh
  await expect.poll(() => bgImage(page)).toMatch(/^url\("blob:/);
  const color = await page.evaluate(async () => {
    const url = getComputedStyle(document.querySelector('[data-testid="reader-bg"]')).backgroundImage.match(/url\("(.*)"\)/)[1];
    const img = new Image(); // không dùng fetch: CSP connect-src chặn blob:
    img.src = url;
    await img.decode();
    const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    return Array.from(x.getImageData(5, 5, 1, 1).data);
  });
  expect(color[0]).toBeGreaterThan(180);
});

test('"Dùng lại ảnh Vương Lâm" xóa ảnh riêng của máy này và trở về ảnh mặc định', async ({ page, baseURL }) => {
  await open(page, baseURL, 'Sach Dung Lai Mac Dinh', DESKTOP);
  await pick(page, { name: 'do.png', mimeType: 'image/png', buffer: solidPng(800, 450, RED) });
  await expect.poll(() => bgImage(page)).toMatch(/^url\("blob:/);
  await page.getByRole('button', { name: 'Dùng lại ảnh Vương Lâm' }).click();
  await expect.poll(() => bgImage(page)).toMatch(/vuong-lam-desktop/);
  expect(await stored(page, 'desktop')).toBeNull();
});

test('Từ chối file không phải ảnh JPG/PNG/WebP, file quá lớn và ảnh hỏng; ảnh cũ giữ nguyên', async ({ page, baseURL }) => {
  await open(page, baseURL, 'Sach Tu Choi', DESKTOP);
  await pick(page, { name: 'ok.png', mimeType: 'image/png', buffer: solidPng(800, 450, RED) });
  await expect.poll(() => stored(page, 'desktop').then((s) => !!s)).toBe(true);

  const input = page.getByLabel('Chọn ảnh từ máy');
  const msg = page.getByRole('alert');

  await input.setInputFiles({ name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
  await expect(msg).toContainText('JPG, PNG hoặc WebP');

  await input.setInputFiles({ name: 'to.png', mimeType: 'image/png', buffer: Buffer.alloc(21 * 1024 * 1024, 1) });
  await expect(msg).toContainText('20 MB');

  await input.setInputFiles({ name: 'hong.png', mimeType: 'image/png', buffer: Buffer.from('khong phai anh that su') });
  await expect(msg).toContainText('Không đọc được ảnh');

  const s = await stored(page, 'desktop');
  expect(s.rgb[0]).toBeGreaterThan(180); // vẫn là ảnh đỏ hợp lệ trước đó
});

test('Thanh trượt "Độ mờ ảnh": chỉnh lớp phủ ảnh trong 40–90%, mặc định 50%, lưu lại, chữ vẫn tương phản >= 7:1 ở mức thấp nhất', async ({ page, baseURL }) => {
  await open(page, baseURL, 'Sach Thanh Truot', DESKTOP);
  await openSettings(page);
  const slider = page.getByLabel('Độ mờ ảnh');
  await expect(slider).toHaveAttribute('min', '40');
  await expect(slider).toHaveAttribute('max', '90');
  await expect(slider).toHaveValue('50');
  const scrimAlpha = () => page.evaluate(() => {
    const c = getComputedStyle(document.querySelector('[data-testid="reader-bg"]'), '::after').backgroundColor;
    const m = c.match(/\(([^)]+)\)/)[1].split(/[ ,/]+/).map(Number);
    return Math.round((m[3] ?? 1) * 100) / 100;
  });
  expect(await scrimAlpha()).toBe(0.5);

  await slider.fill('40');
  await expect.poll(scrimAlpha).toBe(0.4);
  await slider.fill('90');
  await expect.poll(scrimAlpha).toBe(0.9);
  await slider.fill('40');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cuu_u_reader_settings')).ambienceDim)).toBe(40);
  await closeSettings(page);

  // Mức thấp nhất vẫn đọc được chữ trong trường hợp xấu nhất (ảnh trắng nhất hoặc đen nhất phía sau)
  for (const theme of ['white', 'sepia', 'slate']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => ({
      bg: getComputedStyle(document.querySelector('.reader-card')).backgroundColor,
      txt: getComputedStyle(document.querySelector('.reader-body p')).color,
      scrim: getComputedStyle(document.querySelector('[data-testid="reader-bg"]'), '::after').backgroundColor,
    }));
    const rgba = (s) => {
      const m = s.match(/rgba?\(([^)]+)\)/)?.[1].split(/[ ,/]+/).map(Number);
      if (m) return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
      const c = s.match(/color\(srgb ([^)]+)\)/)[1].split(/[ /]+/).map(Number);
      return { r: c[0] * 255, g: c[1] * 255, b: c[2] * 255, a: c[3] ?? 1 };
    };
    const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
    const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const card = rgba(r.bg);
    expect(card.a).toBeGreaterThanOrEqual(0.6);
    for (const k of [0, 255]) {
      const bgc = over(card, over(rgba(r.scrim), { r: k, g: k, b: k, a: 1 }));
      const [a, b] = [lum(bgc), lum(rgba(r.txt))].sort((x, y) => y - x);
      expect((a + 0.05) / (b + 0.05), `theme ${theme}, ảnh nền ${k}`).toBeGreaterThanOrEqual(7);
    }
  }
});
