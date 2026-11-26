import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { collectProblems, uniqueName, PASSWORD } from './helpers.js';

const P = 'Vương Lâm ngồi bên con lộ nhỏ dẫn vào thôn, vẻ mặt ngơ ngác nhìn lên bầu trời xanh thắm. Thuở nhỏ thân thể hắn vốn gầy gò ốm yếu, cha hắn sợ khó nuôi được nên theo tập tục mà đặt tên cúng cơm cho hắn là Thiết Trụ.';
const LABEL = 'Ảnh nền Vương Lâm';

async function epub(title) {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="c1"/></spine></package>`);
  z.file('OEBPS/toc.ncx', '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="n1"><navLabel><text>Chương 1: Xa nhà</text></navLabel><content src="c1.xhtml"/></navPoint></navMap></ncx>');
  z.file('OEBPS/c1.xhtml', `<html><body>${Array.from({ length: 40 }, () => `<p>${P}</p>`).join('')}</body></html>`);
  return Buffer.from(await z.generateAsync({ type: 'uint8array' }));
}

// Ghi lại mọi yêu cầu ảnh nền để biết máy nào tải ảnh nào (và tải bao nhiêu byte)
function watchImages(page) {
  const got = [];
  page.on('response', async (r) => {
    const u = r.url();
    if (/vuong-lam/.test(u)) got.push({ url: u, bytes: (await r.body().catch(() => Buffer.alloc(0))).length });
  });
  return got;
}

async function open(page, baseURL, title, size, { ambience } = {}) {
  await page.setViewportSize(size);
  if (ambience !== undefined) {
    await page.addInitScript((v) => {
      const k = 'cuu_u_reader_settings';
      const s = JSON.parse(localStorage.getItem(k) || '{"uiv":2,"theme":"auto"}');
      s.ambience = v;
      localStorage.setItem(k, JSON.stringify(s));
    }, ambience);
  }
  await page.request.post('/api/auth/register', { headers: { Origin: baseURL }, data: { username: uniqueName(), password: PASSWORD } });
  await page.request.post('/api/books/upload', { headers: { Origin: baseURL }, multipart: { file: { name: 'a.epub', mimeType: 'application/epub+zip', buffer: await epub(title) } } });
  await page.goto('/');
  await page.getByRole('heading', { name: title, level: 4 }).click();
  await expect(page.locator('.reader-body')).toContainText('Vương Lâm', { timeout: 20_000 });
}

const bg = (page) => page.getByTestId('reader-bg');
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('Máy tính: ảnh Vương Lâm phủ kín cả màn hình phía sau thẻ chữ, đứng yên khi cuộn, chỉ tải ảnh máy tính', async ({ page, baseURL }) => {
  const problems = collectProblems(page);
  const imgs = watchImages(page);
  await open(page, baseURL, 'Sach Nen Phu Kin May Tinh', { width: 1440, height: 900 });
  await expect(bg(page)).toBeVisible();
  const b = await bg(page).boundingBox();
  expect(b).toMatchObject({ x: 0, y: 0, width: 1440, height: 900 }); // phủ trọn khung nhìn, cả hai bên thẻ chữ

  expect(await bg(page).evaluate((el) => getComputedStyle(el).backgroundImage)).toMatch(/vuong-lam-desktop/);
  // Thẻ chữ nằm trên ảnh: điểm giữa thẻ thuộc thẻ, không thuộc lớp nền
  expect(await page.evaluate(() => {
    const c = document.querySelector('.reader-card').getBoundingClientRect();
    return !!document.elementFromPoint(c.x + c.width / 2, 300)?.closest('.reader-card');
  })).toBe(true);
  // Chữ thật sự nằm TRÊN ảnh và lớp phủ (không bị phủ mờ): điểm ảnh tối nhất trong vùng chữ phải gần màu chữ gốc
  await page.evaluate(() => { document.documentElement.dataset.theme = 'white'; });
  await page.waitForTimeout(700);
  const tb = await page.locator('.reader-body p').first().boundingBox();
  const png = (await page.screenshot({ clip: { x: tb.x, y: tb.y, width: Math.min(tb.width, 400), height: 40 } })).toString('base64');
  const darkest = await page.evaluate(async (b64) => {
    const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: 'image/png' })); // không dùng fetch: CSP chặn data:
    const c = new OffscreenCanvas(img.width, img.height);
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let m = 255;
    for (let i = 0; i < d.length; i += 4) m = Math.min(m, (d[i] + d[i + 1] + d[i + 2]) / 3);
    return m;
  }, png);
  expect(darkest).toBeLessThan(70);
  // Lề hai bên thẻ là ảnh (không bị chặn bởi phần tử nền đặc nào khác)
  expect(await page.evaluate(() => document.elementFromPoint(60, 450)?.closest('[data-testid="reader-bg"]') !== null
    || document.elementFromPoint(60, 450) === document.querySelector('.reader-content-box')
    || document.elementFromPoint(60, 450) === document.querySelector('.reader-wrapper'))).toBe(true);

  // Cuộn vài trăm px: ảnh vẫn đứng yên, phủ trọn màn hình
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(300);
  const b2 = await bg(page).boundingBox();
  expect(b2).toMatchObject({ x: 0, y: 0, width: 1440, height: 900 });

  await expect.poll(() => imgs.length).toBeGreaterThan(0);
  expect(imgs.every((i) => /vuong-lam-desktop/.test(i.url))).toBe(true); // không tải ảnh điện thoại
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});

test('Điện thoại: bật sẵn, ảnh dọc riêng phủ kín màn hình, chỉ tải ảnh điện thoại, không tràn ngang', async ({ page, baseURL }) => {
  const problems = collectProblems(page);
  const imgs = watchImages(page);
  await open(page, baseURL, 'Sach Nen Phu Kin Dien Thoai', { width: 375, height: 700 });
  await expect(bg(page)).toBeVisible();
  expect(await bg(page).boundingBox()).toMatchObject({ x: 0, y: 0, width: 375, height: 700 });
  expect(await bg(page).evaluate((el) => getComputedStyle(el).backgroundImage)).toMatch(/vuong-lam-phone/);
  await expect.poll(() => imgs.length).toBeGreaterThan(0);
  expect(imgs.every((i) => /vuong-lam-phone/.test(i.url))).toBe(true);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});

test('Tốc độ: ảnh nền nhẹ (máy tính <= 250KB, điện thoại <= 150KB)', async ({ page, baseURL }) => {
  const d = watchImages(page);
  await open(page, baseURL, 'Sach Nhe May Tinh', { width: 1440, height: 900 });
  await expect.poll(() => d.length).toBeGreaterThan(0);
  expect(d[0].bytes).toBeGreaterThan(10_000);
  expect(d[0].bytes).toBeLessThanOrEqual(250_000);

  const ctx = await page.context().browser().newContext();
  const p2 = await ctx.newPage();
  const m = watchImages(p2);
  await p2.goto(baseURL + '/');
  await p2.setViewportSize({ width: 375, height: 700 });
  await p2.request.post('/api/auth/register', { headers: { Origin: baseURL }, data: { username: uniqueName(), password: PASSWORD } }).catch(() => {});
  await ctx.close();
  // Ảnh điện thoại đo trực tiếp qua tệp tĩnh được CSS tham chiếu
  const css = await (await page.request.get('/')).text();
  const cssHref = css.match(/assets\/index-[^"]+\.css/)[0];
  const sheet = await (await page.request.get('/' + cssHref)).text();
  const phoneUrl = sheet.match(/url\(([^)]*vuong-lam-phone[^)]*)\)/)[1].replace(/['"]/g, '');
  const phone = await page.request.get(new URL(phoneUrl, baseURL + '/' + cssHref).toString());
  expect((await phone.body()).length).toBeLessThanOrEqual(150_000);
  expect((await phone.body()).length).toBeGreaterThan(10_000);
  void m;
});

const SIZES = { 'máy tính': { width: 1440, height: 900 }, 'điện thoại': { width: 375, height: 700 } };
for (const [sname, size] of Object.entries(SIZES)) {
  for (const theme of ['white', 'sepia', 'slate']) {
    test(`Chữ vẫn đọc rõ trên nền ảnh (${sname}, theme ${theme}): thẻ mờ mờ nhưng tương phản xấu nhất >= 7:1`, async ({ page, baseURL }) => {
      await open(page, baseURL, `Sach Tuong Phan ${sname} ${theme}`, size);
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await page.waitForTimeout(700); // chờ hiệu ứng chuyển màu của theme xong
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
      const over = (top, base) => ({ r: top.r * top.a + base.r * (1 - top.a), g: top.g * top.a + base.g * (1 - top.a), b: top.b * top.a + base.b * (1 - top.a), a: 1 });
      const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const card = rgba(r.bg);
      const tx = rgba(r.txt);
      const scrim = rgba(r.scrim);
      expect(card.a).toBeGreaterThanOrEqual(0.6); // đủ đục để chữ rõ
      expect(card.a).toBeLessThanOrEqual(0.85); // đủ trong để thấy ảnh
      // Ảnh sáng nhất (trắng) hoặc tối nhất (đen) phía sau lớp phủ, rồi thẻ chữ phủ lên trên
      for (const k of [0, 255]) {
        const backdrop = over(scrim, { r: k, g: k, b: k, a: 1 });
        const bgc = over(card, backdrop);
        const [a, b] = [lum(bgc), lum(tx)].sort((x, y) => y - x);
        expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(7);
      }
    });
  }
}

test('Công tắc "Ảnh nền Vương Lâm": bật sẵn; tắt thì mất ảnh và lưu lại; đã tắt từ trước thì không tải ảnh nào', async ({ page, baseURL }) => {
  await open(page, baseURL, 'Sach Cong Tat Nen', { width: 1440, height: 900 });
  await expect(bg(page)).toBeVisible();
  await page.getByTitle(/Cài đặt giao diện/).click();
  const toggle = page.getByLabel(LABEL);
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.keyboard.press('Escape');
  await expect(bg(page)).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cuu_u_reader_settings')).ambience)).toBe(false);
});

test('Tắt từ trước thì không có lớp nền và không tải ảnh', async ({ page, baseURL }) => {
  const imgs = watchImages(page);
  await open(page, baseURL, 'Sach Tat San', { width: 1440, height: 900 }, { ambience: false });
  await page.waitForTimeout(800);
  await expect(bg(page)).toHaveCount(0);
  expect(imgs).toEqual([]);
});

test('Điện thoại: công tắc có trong cài đặt đọc và đang bật', async ({ page, baseURL }) => {
  await open(page, baseURL, 'Sach Cong Tat Dien Thoai', { width: 375, height: 700 });
  await page.getByRole('navigation', { name: 'Điều hướng chương' }).getByRole('button', { name: 'Cài đặt đọc', exact: true }).click();
  await expect(page.getByLabel(LABEL)).toBeChecked();
});
