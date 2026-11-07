import { test, expect } from '@playwright/test';
import { collectProblems } from './helpers.js';

test('Font tự host: không gọi sang Google Fonts, font đọc truyện tải từ cùng origin', async ({ page, baseURL }) => {
  const problems = collectProblems(page);
  const external = [];
  const fontFiles = [];
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.origin !== new URL(baseURL).origin && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) {
      external.push(req.url());
    }
    if (/\.woff2?$/.test(u.pathname)) fontFiles.push(u.pathname);
  });

  const res = await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  // Ép trình duyệt tải thử một font đọc truyện có chữ tiếng Việt
  const loaded = await page.evaluate(async () => {
    const list = await document.fonts.load("400 18px 'Literata Variable'", 'Chương một ạ ơ ư');
    return list.length;
  });

  expect(external).toEqual([]);
  expect(loaded).toBeGreaterThan(0);
  expect(fontFiles.length).toBeGreaterThan(0);
  const csp = res.headers()['content-security-policy'] || '';
  expect(csp).not.toMatch(/googleapis|gstatic/);
  expect(problems).toEqual([]);
});
