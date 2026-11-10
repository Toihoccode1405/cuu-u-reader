import { test, expect } from '@playwright/test';
import { collectProblems, uniqueName, PASSWORD } from './helpers.js';

const loaded = (loc) => loc.evaluate((img) => img.complete && img.naturalWidth > 0);

test('Logo tu tiên: trang đăng nhập, header thư viện, favicon và biểu tượng cài đặt dùng cùng một logo', async ({ page, baseURL }) => {
  const problems = collectProblems(page);

  // Trang đăng nhập
  await page.goto('/');
  const authLogo = page.locator('.auth-brand-seal img');
  await expect(authLogo).toBeVisible({ timeout: 20_000 });
  expect(await loaded(authLogo)).toBe(true);
  await expect(authLogo).toHaveAttribute('src', /logo-tutien/);

  // Thẻ <head>
  const links = await page.evaluate(() => [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((l) => ({ rel: l.rel, href: l.getAttribute('href') })));
  const icon = links.find((l) => l.rel === 'icon');
  const apple = links.find((l) => l.rel === 'apple-touch-icon');
  expect(icon?.href).toMatch(/\.png$/);
  expect(apple?.href).toMatch(/\.png$/);
  for (const l of [icon, apple]) {
    const r = await page.request.get(l.href);
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain('image/png');
    expect((await r.body()).length).toBeLessThan(60_000); // nhẹ, không phải ảnh gốc 880KB
  }

  // Header thư viện (điện thoại và máy lớn)
  await page.request.post('/api/auth/register', { headers: { Origin: baseURL }, data: { username: uniqueName(), password: PASSWORD } });
  for (const size of [{ width: 375, height: 667 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(size);
    await page.goto('/');
    const logo = page.locator('header.header .brand-seal img');
    await expect(logo).toBeVisible({ timeout: 20_000 });
    expect(await loaded(logo)).toBe(true);
    const box = await logo.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(28);
    expect(box.width).toBeLessThanOrEqual(44);
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
  }
  expect(problems).toEqual([]);
});
