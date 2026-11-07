import JSZip from 'jszip';

export function uniqueName(prefix = 'e2e') {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`;
}

export const PASSWORD = 'mat-khau-e2e-12345';

// EPUB nhỏ có 3 chương, tạo bằng code
export async function buildEpubBuffer(title = 'Sach E2E') {
  const chapters = ['Noi dung chuong mot', 'Noi dung chuong hai', 'Noi dung chuong ba'];
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const items = chapters.map((_, i) => `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('');
  const spine = chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>Tac Gia</dc:creator></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${items}</manifest><spine toc="ncx">${spine}</spine></package>`);
  const points = chapters.map((_, i) => `<navPoint id="n${i + 1}"><navLabel><text>Chuong ${i + 1}</text></navLabel><content src="c${i + 1}.xhtml"/></navPoint>`).join('');
  z.file('OEBPS/toc.ncx', `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>${points}</navMap></ncx>`);
  chapters.forEach((text, i) => z.file(`OEBPS/c${i + 1}.xhtml`, `<html><body><p>${text}</p></body></html>`));
  return Buffer.from(await z.generateAsync({ type: 'uint8array' }));
}

// Gom lỗi console và lỗi CSP để test khẳng định trang sạch
export function collectProblems(page) {
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // Ghi rõ địa chỉ nào trả lỗi (404, 500...) để biết nguyên nhân thay vì chỉ thấy "Failed to load resource"
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`);
  });
  return problems;
}
