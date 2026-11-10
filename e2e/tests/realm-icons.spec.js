import { test, expect } from '@playwright/test';
import { collectProblems, uniqueName, PASSWORD } from './helpers.js';

async function openLibrary(page, baseURL) {
  await page.request.post('/api/auth/register', { headers: { Origin: baseURL }, data: { username: uniqueName(), password: PASSWORD } });
  await page.goto('/');
  await expect(page.getByTestId('cultivation-chip')).toBeVisible({ timeout: 20_000 });
}

const anim = (loc) => loc.evaluate((el) => getComputedStyle(el).animationName);

test('Icon cảnh giới động: dùng bộ SVG mới, giữ hoạt ảnh thở + vòng xoay quanh tâm', async ({ page, baseURL }) => {
  const problems = collectProblems(page);
  const externalRequests = [];
  page.on('request', (r) => { if (!r.url().startsWith(baseURL) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) externalRequests.push(r.url()); });
  await openLibrary(page, baseURL);

  const chipIcon = page.getByTestId('cultivation-chip').locator('svg[data-icon="Ngưng Khí"]');
  await expect(chipIcon).toBeVisible();
  expect(await chipIcon.getAttribute('viewBox')).toBe('0 0 100 100');
  expect(await anim(chipIcon)).toBe('realm-breathe');

  // Bộ icon mới của người dùng (màu lam Ngưng Khí), không phải bộ game-icons cũ
  expect(await chipIcon.innerHTML()).toContain('#38bdf8');
  expect(await chipIcon.innerHTML()).not.toContain('fill="currentColor"');

  // Vòng nét đứt xoay tại chỗ: tâm không được trôi (không quay quanh góc trên-trái)
  const spin = chipIcon.locator('.realm-spin');
  await expect(spin).toHaveCount(1);
  expect(await anim(spin)).toBe('realm-spin');
  const center = () => spin.evaluate((el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  const c1 = await center();
  await page.waitForTimeout(1500);
  const c2 = await center();
  expect(Math.abs(c1[0] - c2[0])).toBeLessThanOrEqual(0.5);
  expect(Math.abs(c1[1] - c2[1])).toBeLessThanOrEqual(0.5);

  // Bảng cảnh giới: đủ 20 bậc, mỗi bậc một hình riêng, hết mục ghi công game-icons
  await page.getByTestId('cultivation-chip').click();
  const dialog = page.getByRole('dialog', { name: 'Con đường tu luyện' });
  const rows = dialog.getByTestId('realm-row');
  await expect(rows).toHaveCount(20);
  const drawings = await rows.locator('svg').evaluateAll((els) => els.map((e) => e.innerHTML));
  expect(new Set(drawings).size).toBe(20);
  await expect(dialog.locator('svg[data-fallback]')).toHaveCount(0);
  await expect(dialog).not.toContainText('game-icons');
  for (const svg of await rows.locator('svg').all()) expect(await anim(svg)).toBe('realm-breathe');

  expect(externalRequests).toEqual([]);
  expect(problems).toEqual([]);
});

test('Icon cảnh giới: tắt hoạt ảnh khi người dùng chọn giảm chuyển động', async ({ page, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLibrary(page, baseURL);
  const icon = page.getByTestId('cultivation-chip').locator('svg[data-icon="Ngưng Khí"]');
  await expect(icon).toBeVisible();
  expect(await anim(icon)).toBe('none');
  expect(await anim(icon.locator('.realm-spin'))).toBe('none');
});

const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);

for (const theme of ['white', 'sepia', 'slate']) {
  test(`Bảng cảnh giới đọc rõ ở theme ${theme}: chữ tên, "từ N" và dòng tổng tương phản đủ`, async ({ page, baseURL }) => {
    await openLibrary(page, baseURL);
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.getByTestId('cultivation-chip').click();
    const dialog = page.getByRole('dialog', { name: 'Con đường tu luyện' });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(400);
    const m = await dialog.evaluate((d) => {
      const cs = (el) => getComputedStyle(el);
      const row = d.querySelector('.realm-row.current');
      return {
        bg: cs(d).backgroundColor,
        title: cs(d.querySelector('h3')).color,
        name: cs(row.querySelector('.realm-row-name')).color,
        at: cs(row.querySelector('.realm-row-at')).color,
        total: cs(d.querySelector('.realm-path-total')).color,
      };
    });
    const bg = rgb(m.bg);
    for (const k of ['title', 'name', 'at', 'total']) expect(contrast(rgb(m[k]), bg), `${theme} ${k}`).toBeGreaterThanOrEqual(4.5);
  });
}

test('Bước thứ tư: bảng có 4 Bước, Bán Bộ Đạp Thiên (quá độ) và Đạp Thiên Cảnh, danh hiệu dưới Không Kiếp', async ({ page, baseURL }) => {
  const problems = collectProblems(page);
  await openLibrary(page, baseURL);
  await page.getByTestId('cultivation-chip').click();
  const dialog = page.getByRole('dialog', { name: 'Con đường tu luyện' });
  await expect(dialog).toBeVisible();

  // Bốn đề mục Bước, Bước 4 có màu riêng (đỏ thẫm)
  await expect(dialog.locator('.realm-path-buoc')).toHaveCount(4);
  const head4 = dialog.locator('.realm-path-buoc.buoc-4');
  await expect(head4).toHaveText('Bước thứ tư · Đạp Thiên siêu thoát');
  expect(await head4.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(179, 38, 62)');

  const rows = dialog.getByTestId('realm-row');
  const names = await rows.locator('.realm-row-name').evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim()));
  expect(names.slice(-3)).toEqual(['Không Kiếp', 'Bán Bộ Đạp Thiên', 'Đạp Thiên Cảnh']);

  // Bán Bộ Đạp Thiên: bậc quá độ có alias; Đạp Thiên Cảnh: đỉnh, mốc 13.490.000
  const ban = rows.filter({ hasText: 'Bán Bộ Đạp Thiên' });
  await expect(ban).toContainText('Đạp Thiên Cửu Kiều');
  await expect(ban).toContainText('12.290.000');
  const dap = rows.filter({ hasText: 'Đạp Thiên Cảnh' });
  await expect(dap).toContainText('13.490.000');

  // Danh hiệu chiến lực hiện dưới Không Kiếp, mỗi danh hiệu kèm điều kiện
  const kk = rows.filter({ hasText: 'Không Kiếp' });
  for (const t of ['Kim Tôn: Hậu Kỳ đỉnh phong', 'Thiên Tôn: Viên Mãn', 'Dược Thiên Tôn: Quá độ', 'Đại Thiên Tôn: ngưng tụ Thiên Tôn Chi Dương']) await expect(kk).toContainText(t);

  // Mỗi bậc mới có icon động riêng, không dùng icon dự phòng
  for (const n of ['Bán Bộ Đạp Thiên', 'Đạp Thiên Cảnh']) {
    const icon = dialog.locator(`svg[data-icon="${n}"]`);
    await expect(icon).toHaveCount(1);
    expect(await anim(icon)).toBe('realm-breathe');
  }
  await expect(dialog.locator('svg[data-fallback]')).toHaveCount(0);
  expect(problems).toEqual([]);
});

// Giả lập /api/cultivation để đứng đúng cấp cần xem mà không phải đọc hàng triệu từ
const STAGES = {
  kiep: { tu_vi: 10_900_000, realm: { name: 'Huyền Kiếp', alias: null, buoc: 3, buoc_name: 'Tam bộ vô biên', qua_do: false, tang: 7, tangs: 9, stage: 'Thập Tức Khô Thần Kiếp', note: 'Hồn Kiếp', progress: 0.4, max: false } },
  kieu: { tu_vi: 12_500_000, realm: { name: 'Bán Bộ Đạp Thiên', alias: 'Đạp Thiên Cửu Kiều', buoc: 3, buoc_name: 'Tam bộ vô biên', qua_do: true, tang: 2, tangs: 9, stage: 'Đệ Nhị Kiều', note: 'Đạp Thiên Nhãn', progress: 0.3, max: false } },
  ky: { tu_vi: 60_000, realm: { name: 'Trúc Cơ', alias: null, buoc: 1, buoc_name: 'Nhất bộ tung hoành', qua_do: false, tang: 2, tangs: 4, stage: 'Trung Kỳ', note: null, progress: 0.7, max: false } },
  mot: { tu_vi: 14_000_000, realm: { name: 'Đạp Thiên Cảnh', alias: null, buoc: 4, buoc_name: 'Đạp Thiên siêu thoát', qua_do: false, tang: 1, tangs: 1, stage: null, note: null, progress: 0.4, max: false } },
};

async function openAs(page, baseURL, key, size) {
  await page.setViewportSize(size);
  await page.route('**/api/cultivation', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ json: { enabled: true, ...STAGES[key] } })
    : route.continue()));
  await openLibrary(page, baseURL);
}

for (const size of [{ width: 320, height: 640 }, { width: 375, height: 667 }, { width: 1280, height: 800 }]) {
  for (const key of ['kiep', 'kieu', 'ky', 'mot']) {
    test(`Chip tu vi hiện đúng cấp (${key}, ${size.width}px), không làm header tràn`, async ({ page, baseURL }) => {
      await openAs(page, baseURL, key, size);
      const chip = page.getByTestId('cultivation-chip');
      const r = STAGES[key].realm;
      await expect(chip).toContainText(r.stage || r.name);
      if (size.width > 640 && r.stage) await expect(chip).toContainText(`${r.name} · ${r.stage}`);
      await expect(chip).not.toContainText(/tầng/i);
      // Tên bị cắt bằng … trên màn hẹp thì vẫn đọc đủ ở tooltip
      await expect(chip).toHaveAttribute('title', new RegExp(`${r.name}${r.stage ? ` · ${r.stage}` : ''}`));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      for (const b of await page.locator('header.header').locator('button:visible, label:visible').all()) {
        const box = await b.boundingBox();
        expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);
      }
    });
  }
}

test('Bảng cảnh giới: dòng đang đứng ghi cấp và chú thích, dòng khác không; không còn chữ "tầng"', async ({ page, baseURL }) => {
  await openAs(page, baseURL, 'kieu', { width: 420, height: 900 });
  await page.getByTestId('cultivation-chip').click();
  const dialog = page.getByRole('dialog', { name: 'Con đường tu luyện' });
  const cur = dialog.locator('[aria-current="true"]');
  await expect(cur).toContainText('Bán Bộ Đạp Thiên');
  await expect(cur).toContainText('Đệ Nhị Kiều');
  await expect(cur).toContainText('Đạp Thiên Nhãn');
  await expect(dialog.getByTestId('realm-row').filter({ hasText: 'Huyền Kiếp' })).not.toContainText('Hồn Kiếp');
  await expect(dialog).not.toContainText(/tầng/i);
});

test('Bảng cảnh giới: Huyền Kiếp hiện tên kiếp và nhóm Hồn Kiếp khi đang đứng ở đó', async ({ page, baseURL }) => {
  await openAs(page, baseURL, 'kiep', { width: 420, height: 900 });
  await page.getByTestId('cultivation-chip').click();
  const cur = page.getByRole('dialog', { name: 'Con đường tu luyện' }).locator('[aria-current="true"]');
  await expect(cur).toContainText('Thập Tức Khô Thần Kiếp');
  await expect(cur).toContainText('Hồn Kiếp');
});

