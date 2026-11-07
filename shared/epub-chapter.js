// Cắt nội dung thô của một chương ra khỏi file XHTML trong EPUB.
// Dùng chung cho Worker (đọc chương khi chưa được tách) và trình duyệt (Tách chương / Tách bù),
// để hai nơi luôn cắt giống hệt nhau. Không phụ thuộc môi trường: mọi thứ cần ngoài đều truyền vào.

export function safeDecodeURI(uri) {
  try {
    return decodeURIComponent(uri);
  } catch (e) {
    return uri;
  }
}

// EPUB hay gộp nhiều chương vào một file XHTML và đánh dấu mỗi chương bằng một anchor (#filepos...).
// Chương chạy từ anchor của nó tới anchor của chương kế tiếp trong cùng file.
export function anchorOffset(html, anchor) {
  if (!anchor) return -1;
  const decodedAnchor = safeDecodeURI(anchor);
  let pos = -1;
  const candidates = anchor === decodedAnchor ? [anchor] : [anchor, decodedAnchor];
  for (const a of candidates) {
    for (const p of [`id="${a}"`, `id='${a}'`, `name="${a}"`, `name='${a}'`]) {
      const i = html.indexOf(p);
      if (i >= 0 && (pos < 0 || i < pos)) pos = i;
    }
  }
  if (pos < 0) return -1;
  const lt = html.lastIndexOf('<', pos);
  return lt >= 0 ? lt : pos;
}

export function splitHref(href) {
  const raw = (href || '').trim();
  const hashAt = raw.indexOf('#');
  if (hashAt < 0) return { file: safeDecodeURI(raw).replace(/\\/g, '/'), anchor: '' };
  return {
    file: safeDecodeURI(raw.slice(0, hashAt)).replace(/\\/g, '/'),
    anchor: safeDecodeURI(raw.slice(hashAt + 1)),
  };
}

// Trả về HTML thô (chưa lọc) của chương `chapterIdx`, hoặc chuỗi rỗng nếu không tìm thấy.
// `findZipFile(zip, name)` do nơi gọi cung cấp (Worker và trình duyệt tìm file trong zip hơi khác nhau).
// `cleanFallback(raw)` (tùy chọn) được dùng khi không tìm thấy anchor: trả nguyên file.
export async function extractChapterRaw(zip, toc, chapterIdx, targetCh, findZipFile) {
  if (!targetCh || !targetCh.href) return '';

  const { file, anchor } = splitHref(targetCh.href);
  const chFile = findZipFile(zip, file);
  if (!chFile) return '';

  const raw = await chFile.async('text');

  // Mục đầu tiên của mỗi file trong NCX KHÔNG kèm #fragment, trong khi các mục sau trong cùng file thì có.
  // Không có anchor => chương bắt đầu từ đầu file, và vẫn phải cắt tại anchor của chương kế tiếp.
  const found = anchor ? anchorOffset(raw, anchor) : 0;
  if (anchor && found < 0) return raw;
  const start = found >= 0 ? found : 0;

  // Anchor chương kế tiếp gần nhất trong cùng file đóng chương này.
  let end = -1;
  for (const c of toc) {
    if (!c || c.index <= chapterIdx) continue;
    const other = splitHref(c.href);
    if (other.file !== file || !other.anchor) continue;
    const off = anchorOffset(raw, other.anchor);
    if (off > start && (end < 0 || off < end)) end = off;
  }

  return end > start ? raw.slice(start, end) : raw.slice(start);
}
