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

  // Bảng cảnh giới: đủ 18 bậc, mỗi bậc một hình riêng, hết mục ghi công game-icons
  await page.getByTestId('cultivation-chip').click();
  const dialog = page.getByRole('dialog', { name: 'Con đường tu luyện' });
  const rows = dialog.getByTestId('realm-row');
  await expect(rows).toHaveCount(18);
  const drawings = await rows.locator('svg').evaluateAll((els) => els.map((e) => e.innerHTML));
  expect(new Set(drawings).size).toBe(18);
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
