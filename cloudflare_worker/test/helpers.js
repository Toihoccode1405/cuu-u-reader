import { exports } from 'cloudflare:workers';
import JSZip from 'jszip';

export const ORIGIN = 'https://example.com';

export const COOKIE_NAME = '__Host-session';

// Lấy giá trị cookie phiên từ phản hồi (Set-Cookie)
export function cookieFrom(res) {
  const raw = res.headers.get('set-cookie') || '';
  const m = raw.match(new RegExp(`${COOKIE_NAME}=([^;]*)`));
  return m ? m[1] : null;
}

// `token` là giá trị cookie phiên; trình duyệt thật tự gửi cookie và header Origin cho yêu cầu ghi,
// nên helper làm giống vậy (đặt `origin: null` để bỏ header Origin, `origin: '...'` để giả origin khác).
export async function api(path, { method = 'GET', body, token, headers = {}, origin = ORIGIN } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.Cookie = `${COOKIE_NAME}=${token}`;
  if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(method) && !init.headers.Origin) init.headers.Origin = origin;
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return exports.default.fetch(new Request(ORIGIN + path, init));
}

let counter = 0;
export function uniqueName(prefix = 'user') {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

export const PASSWORD = 'mat-khau-dai-12345';

export async function registerUser(name = uniqueName(), password = PASSWORD) {
  const res = await api('/api/auth/register', { method: 'POST', body: { username: name, password } });
  const data = await res.json().catch(() => ({}));
  return { res, name, password, token: cookieFrom(res), user: data.user };
}

// EPUB tối thiểu tạo bằng code (không cần file thật): mỗi chương là một file XHTML
export async function buildEpub({ title = 'Sach Thu', chapters = ['Doan mot', 'Doan hai'] } = {}) {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
  );
  const items = chapters
    .map((_, i) => `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('');
  const spine = chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('');
  z.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>Tac Gia</dc:creator></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${items}</manifest><spine toc="ncx">${spine}</spine></package>`
  );
  const points = chapters
    .map(
      (_, i) =>
        `<navPoint id="n${i + 1}"><navLabel><text>Chuong ${i + 1}</text></navLabel><content src="c${i + 1}.xhtml"/></navPoint>`
    )
    .join('');
  z.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>${points}</navMap></ncx>`
  );
  chapters.forEach((text, i) =>
    z.file(`OEBPS/c${i + 1}.xhtml`, `<html><body><p>${text}</p></body></html>`)
  );
  return z.generateAsync({ type: 'uint8array' });
}

// EPUB kiểu "nhiều chương trong một file XHTML", mỗi chương bắt đầu ở một anchor (#a1, #a2, ...)
export async function buildAnchoredEpub({ title = 'Mot File', chapters = ['Chuong A', 'Chuong B', 'Chuong C'] } = {}) {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
  );
  z.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>Tac Gia</dc:creator></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="all" href="all.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="all"/></spine></package>`
  );
  const points = chapters
    .map(
      (name, i) =>
        `<navPoint id="n${i + 1}"><navLabel><text>${name}</text></navLabel><content src="all.xhtml#a${i + 1}"/></navPoint>`
    )
    .join('');
  z.file('OEBPS/toc.ncx', `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>${points}</navMap></ncx>`);
  const body = chapters.map((name, i) => `<h2 id="a${i + 1}">${name}</h2><p>Noi dung cua ${name}</p>`).join('');
  z.file('OEBPS/all.xhtml', `<html><body>${body}</body></html>`);
  return z.generateAsync({ type: 'uint8array' });
}

export async function uploadBook(token, epubBytes, filename = 'sach.epub') {
  const fd = new FormData();
  fd.append('file', new Blob([epubBytes]), filename);
  const res = await exports.default.fetch(
    new Request(ORIGIN + '/api/books/upload', {
      method: 'POST',
      headers: { Cookie: `${COOKIE_NAME}=${token}`, Origin: ORIGIN },
      body: fd,
    })
  );
  return { res, book: res.ok ? await res.json() : null };
}
