import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { collectProblems, uniqueName, PASSWORD } from './helpers.js';

const P = 'Vương Lâm ngồi bên con lộ nhỏ dẫn vào thôn, vẻ mặt ngơ ngác nhìn lên bầu trời xanh thắm. Thuở nhỏ thân thể hắn vốn gầy gò ốm yếu, cha hắn sợ khó nuôi được nên theo tập tục mà đặt tên cúng cơm cho hắn là Thiết Trụ.';

async function epub(title) {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="c1"/></spine></package>`);
  z.file('OEBPS/toc.ncx', '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="n1"><navLabel><text>Chương 1: Xa nhà</text></navLabel><content src="c1.xhtml"/></navPoint></navMap></ncx>');
  z.file('OEBPS/c1.xhtml', `<html><body>${Array.from({ length: 40 }, () => `<p>${P}</p>`).join('')}</body></html>`);
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

const DESKTOP = { width: 1440, height: 900 };
const fight = (page) => page.getByTestId('pixel-fight');
const figure = (page) => page.getByTestId('ambience-figure');

async function hoverPara(page, i) {
  const box = await page.locator(`.reader-body [data-p="${i}"]`).boundingBox();
  const vh = page.viewportSize().height;
  expect(box.y + 40, `đoạn ${i} phải nằm trong màn hình để chuột chỉ tới được`).toBeLessThan(vh);
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 40);
  await page.mouse.move(x - 30, y - 5);
  await page.mouse.move(x, y, { steps: 4 });
  return { x, y };
}

const pixels = (loc) => loc.evaluate((c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
});

test('Nền: nhân vật Vương Lâm đứng ở lề trái ngoài thẻ chữ, đổi bản đảo mức xám ở theme tối, không tràn ngang', async ({ page, baseURL }) => {
  const problems = collectProblems(page);
  await open(page, baseURL, 'Sach Nen Nhan Vat', DESKTOP);
  const fig = figure(page);
  await expect(fig).toBeVisible();
  const card = await page.locator('.reader-card').boundingBox();
  const b = await fig.boundingBox();
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(card.x); // nằm ở lề trái, không đè lên chữ
  expect(b.height).toBeLessThanOrEqual(DESKTOP.height * 0.62);
  expect(b.width).toBeLessThanOrEqual(365);

  const bg = () => fig.evaluate((el) => getComputedStyle(el).backgroundImage);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'white'; });
  expect(await bg()).toMatch(/vuong-lam-light/);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'slate'; });
  expect(await bg()).toMatch(/vuong-lam-dark/);

  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});

test('Pixel tu tiên: chỉ chuột vào đoạn chữ thì hiện ở lề phải, đánh nhau rồi biến mất, hover không gọi API', async ({ page, baseURL }) => {
  const problems = collectProblems(page);
  await open(page, baseURL, 'Sach Pixel Danh Nhau', DESKTOP);
  const f = fight(page);
  await expect(f).toHaveAttribute('data-state', 'idle');
  await expect(f).not.toHaveClass(/active/);

  await page.waitForTimeout(1500); // chờ đồng bộ cài đặt lần đầu (tự gọi sau 600ms) xong, để chỉ đo những gì do chuột gây ra
  const apiCalls = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) apiCalls.push(r.url()); });

  const { y } = await hoverPara(page, 0);
  await expect(f).toHaveAttribute('data-state', 'fighting', { timeout: 1500 });
  await expect(f).toHaveClass(/active/);
  const card = await page.locator('.reader-card').boundingBox();
  const fb = await f.boundingBox();
  expect(fb.x).toBeGreaterThanOrEqual(card.x + card.width - 1); // lề phải, không đè chữ
  expect(fb.x + fb.width).toBeLessThanOrEqual(DESKTOP.width);
  expect(Math.abs(fb.y + fb.height / 2 - y)).toBeLessThanOrEqual(130); // bám theo chỗ chuột đang chỉ

  await page.waitForTimeout(1200);
  expect(await pixels(f)).toBeGreaterThan(60); // thật sự có hình vẽ, không phải canvas trống

  // Vài giây sau thì tự biến mất
  await expect(f).toHaveAttribute('data-state', 'idle', { timeout: 7000 });
  await expect(f).not.toHaveClass(/active/);
  expect(await f.getAttribute('data-scenes')).toBe('1');

  // Chỉ vào đoạn khác thì có trận mới
  await hoverPara(page, 1);
  await expect(f).toHaveAttribute('data-state', 'fighting', { timeout: 2500 });
  expect(await f.getAttribute('data-scenes')).toBe('2');

  expect(apiCalls, apiCalls.join(' ')).toEqual([]);
  expect(problems).toEqual([]);
});

test('Pixel tu tiên: màn dưới 1100px không có nhân vật hay pixel, chuột chỉ vào chữ cũng không hiện', async ({ page, baseURL }) => {
  await open(page, baseURL, 'Sach Man Nho', { width: 1000, height: 800 });
  await expect(figure(page)).toBeHidden();
  await expect(fight(page)).toBeHidden();
  await hoverPara(page, 0);
  await page.waitForTimeout(600);
  await expect(fight(page)).toHaveAttribute('data-state', 'idle');
  await expect(fight(page)).toHaveAttribute('data-scenes', '0');
});

test('Công tắc "Hiệu ứng nền và chiến đấu": tắt thì mất cả nhân vật lẫn pixel', async ({ page, baseURL }) => {
  await open(page, baseURL, 'Sach Cong Tat Nen', DESKTOP);
  await expect(figure(page)).toBeVisible();
  await page.getByTitle(/Cài đặt giao diện/).click();
  const toggle = page.getByLabel('Hiệu ứng nền và chiến đấu');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.keyboard.press('Escape');
  await expect(figure(page)).toHaveCount(0);
  await expect(fight(page)).toHaveCount(0);
  await hoverPara(page, 0);
  await page.waitForTimeout(500);
  await expect(fight(page)).toHaveCount(0);
  // Lưu vào cài đặt
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cuu_u_reader_settings')).ambience);
  expect(saved).toBe(false);
});

test('Giảm chuyển động: vẫn thấy nhân vật đứng yên nhưng pixel không đánh nhau', async ({ page, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, baseURL, 'Sach Giam Chuyen Dong', DESKTOP);
  await expect(figure(page)).toBeVisible();
  await hoverPara(page, 0);
  await page.waitForTimeout(700);
  await expect(fight(page)).toHaveAttribute('data-state', 'idle');
  await expect(fight(page)).toHaveAttribute('data-scenes', '0');
});

test('Điện thoại: mặc định tắt (không banner, không pixel); bật công tắc thì có banner đầu chương, vẫn không tràn và không có pixel', async ({ page, baseURL }) => {
  const problems = collectProblems(page);
  await open(page, baseURL, 'Sach Banner Dien Thoai', { width: 375, height: 700 });
  await expect(page.getByTestId('ambience-banner')).toHaveCount(0);
  await expect(figure(page)).toBeHidden();
  await expect(fight(page)).toBeHidden();

  await page.getByRole('navigation', { name: 'Điều hướng chương' }).getByRole('button', { name: 'Cài đặt đọc', exact: true }).click();
  await page.getByLabel('Hiệu ứng nền và chiến đấu').check();
  await page.keyboard.press('Escape');
  const banner = page.getByTestId('ambience-banner');
  await expect(banner).toBeVisible();
  const bb = await banner.boundingBox();
  expect(bb.x).toBeGreaterThanOrEqual(0);
  expect(bb.x + bb.width).toBeLessThanOrEqual(375.5);
  expect(bb.height).toBeLessThanOrEqual(220);
  expect(await banner.evaluate((el) => getComputedStyle(el).backgroundImage)).toMatch(/vuong-lam/);
  await expect(figure(page)).toBeHidden();
  await expect(fight(page)).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});
