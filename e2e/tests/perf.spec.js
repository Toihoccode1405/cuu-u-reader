// Đo tốc độ mở chương trên sách lớn. Chạy riêng: PERF=1 npx playwright test perf
// Số đo chạy trên Worker cục bộ (wrangler dev), dùng để so sánh trước/sau chứ không thay cho số đo trên prod.
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { uniqueName, PASSWORD } from './helpers.js';

test.skip(!process.env.PERF, 'chỉ chạy khi đặt PERF=1');

const CHAPTERS = 200;
const WORDS_PER_CHAPTER = 9000; // ~50KB chữ mỗi chương, sách cỡ ~10MB sau khi nén

function randomText(words, seed) {
  let x = seed;
  const out = [];
  for (let i = 0; i < words; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out.push(x.toString(36));
  }
  return out.join(' ');
}

async function buildBigEpub() {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const ids = Array.from({ length: CHAPTERS }, (_, i) => i + 1);
  const items = ids.map((i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('');
  const spine = ids.map((i) => `<itemref idref="c${i}"/>`).join('');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Sach Lon</dc:title><dc:creator>Tac Gia</dc:creator></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${items}</manifest><spine toc="ncx">${spine}</spine></package>`);
  const points = ids.map((i) => `<navPoint id="n${i}"><navLabel><text>Chuong ${i}</text></navLabel><content src="c${i}.xhtml"/></navPoint>`).join('');
  z.file('OEBPS/toc.ncx', `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>${points}</navMap></ncx>`);
  for (const i of ids) {
    const paras = randomText(WORDS_PER_CHAPTER, i).match(/.{1,400}(\s|$)/g).map((p) => `<p>${p}</p>`).join('');
    z.file(`OEBPS/c${i}.xhtml`, `<html><body><p>Noi dung chuong ${i}</p>${paras}</body></html>`);
  }
  return Buffer.from(await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}

async function timed(fn) {
  const t = performance.now();
  const r = await fn();
  return { ms: Math.round(performance.now() - t), r };
}

test('Đo: chương mở lần đầu (máy chủ tự tách) so với chương đã tách sẵn', async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const reg = await page.request.post('/api/auth/register', {
    headers: { Origin: baseURL },
    data: { username: uniqueName('perf'), password: PASSWORD },
  });
  expect(reg.ok()).toBe(true);

  const epub = await buildBigEpub();
  const sizeMb = (epub.length / 1048576).toFixed(1);
  const up = await timed(() => page.request.post('/api/books/upload', {
    headers: { Origin: baseURL },
    multipart: { file: { name: 'lon.epub', mimeType: 'application/epub+zip', buffer: epub } },
  }));
  expect(up.r.ok()).toBe(true);
  const { id } = await up.r.json();

  const get = (n) => timed(() => page.request.get(`/api/books/${id}/chapters/${n}`));
  const first = await get(1);
  const firstOther = await get(150);
  await page.waitForTimeout(500); // chờ ghi cache nền
  const again = await get(150);
  const rounds = [];
  for (let i = 0; i < 5; i++) rounds.push((await get(150)).ms);

  console.log(`PERF epub=${sizeMb}MB chương=${CHAPTERS} upload=${up.ms}ms`);
  console.log(`PERF mở lần đầu chương 1=${first.ms}ms, chương 150=${firstOther.ms}ms`);
  console.log(`PERF đã tách: chương 150 lần 2=${again.ms}ms, 5 lần sau=[${rounds.join(', ')}]ms`);

  expect(again.ms).toBeLessThan(300);
  expect(firstOther.ms).toBeLessThan(1500);
});
