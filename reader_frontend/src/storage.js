import JSZip from 'jszip';

const DB_NAME = 'CuuUReaderDB';
const DB_VERSION = 1;
const STORE_NAME = 'books';

// Initialize IndexedDB
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

// Get all books
export async function getAllBooksFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      // Return metadata only (exclude heavy chapter file contents for list view)
      const list = (req.result || []).map(b => ({
        id: b.id,
        title: b.title,
        author: b.author,
        total_chapters: b.chapters.length,
        current_chapter: b.current_chapter || 1,
        scroll_percent: b.scroll_percent || 0,
        has_cover: !!b.cover_data,
        cover_url: b.cover_data || null,
        added_at: b.added_at
      }));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

// Get single book with all chapters & files
export async function getBookFromDB(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Save book to IndexedDB
export async function saveBookToDB(book) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(book);
    req.onsuccess = () => resolve(book);
    req.onerror = () => reject(req.error);
  });
}

// Delete book
export async function deleteBookFromDB(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// Update reading progress
export async function updateProgressInDB(id, chapterIndex, scrollPercent) {
  const db = await openDB();
  const book = await getBookFromDB(id);
  if (!book) return;
  book.current_chapter = chapterIndex;
  book.scroll_percent = scrollPercent;
  await saveBookToDB(book);
}

// Pure Client-side EPUB Parser (Runs 100% in browser on phone/PC without backend)
export async function parseEpubClient(file) {
  const zip = await JSZip.loadAsync(file);

  // 1. Read META-INF/container.xml
  const containerXmlStr = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXmlStr) throw new Error('File không hợp lệ: Thiếu META-INF/container.xml');

  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXmlStr, 'application/xml');
  const rootfileEl = containerDoc.querySelector('rootfile');
  const opfPath = rootfileEl?.getAttribute('full-path');
  if (!opfPath) throw new Error('Không tìm thấy đường dẫn content.opf');

  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : '';

  // 2. Read OPF
  const opfXmlStr = await zip.file(opfPath)?.async('text');
  if (!opfXmlStr) throw new Error('Không tìm thấy file ' + opfPath);

  const opfDoc = parser.parseFromString(opfXmlStr, 'application/xml');
  const title = opfDoc.querySelector('title')?.textContent || file.name.replace(/\.epub$/i, '');
  const author = opfDoc.querySelector('creator')?.textContent || 'Khuyết danh';

  // Build manifest
  const manifest = {};
  opfDoc.querySelectorAll('manifest item').forEach(item => {
    manifest[item.getAttribute('id')] = item.getAttribute('href');
  });

  // Extract cover
  let coverData = null;
  const coverMeta = opfDoc.querySelector('meta[name="cover"]');
  let coverHref = null;
  if (coverMeta) {
    coverHref = manifest[coverMeta.getAttribute('content')];
  }
  if (!coverHref) {
    // Try finding item with id or href containing 'cover'
    const coverItem = Object.entries(manifest).find(([id, href]) => 
      id.toLowerCase().includes('cover') && /\.(jpg|jpeg|png|webp)$/i.test(href)
    );
    if (coverItem) coverHref = coverItem[1];
  }

  if (coverHref) {
    const fullCoverPath = resolveZipPath(opfDir, coverHref);
    const coverFile = zip.file(fullCoverPath);
    if (coverFile) {
      const coverBase64 = await coverFile.async('base64');
      const ext = coverHref.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
      coverData = `data:image/${ext};base64,${coverBase64}`;
    }
  }

  // 3. Parse TOC
  let chapters = [];
  const ncxItem = Object.entries(manifest).find(([id, href]) => href.toLowerCase().endsWith('.ncx'));
  if (ncxItem) {
    const ncxPath = resolveZipPath(opfDir, ncxItem[1]);
    const ncxXmlStr = await zip.file(ncxPath)?.async('text');
    if (ncxXmlStr) {
      const ncxDoc = parser.parseFromString(ncxXmlStr, 'application/xml');
      const navPoints = ncxDoc.querySelectorAll('navPoint');
      navPoints.forEach((np, i) => {
        const t = np.querySelector('navLabel text')?.textContent || `Chương ${i + 1}`;
        const src = np.querySelector('content')?.getAttribute('src');
        if (src) {
          chapters.push({
            index: i + 1,
            title: t.trim(),
            href: resolveZipPath(opfDir, src.split('#')[0])
          });
        }
      });
    }
  }

  // Fallback: spine order
  if (chapters.length === 0) {
    const itemrefs = opfDoc.querySelectorAll('spine itemref');
    itemrefs.forEach((ref, i) => {
      const idref = ref.getAttribute('idref');
      const href = manifest[idref];
      if (href) {
        chapters.push({
          index: i + 1,
          title: `Chương ${i + 1}`,
          href: resolveZipPath(opfDir, href.split('#')[0])
        });
      }
    });
  }

  // 4. Preload and clean all chapter HTML files into a map
  const files = {};
  for (const ch of chapters) {
    const f = zip.file(ch.href);
    if (f) {
      const htmlText = await f.async('text');
      files[ch.href] = cleanXhtml(htmlText);
    } else {
      files[ch.href] = '<p>Không tìm thấy nội dung chương.</p>';
    }
  }

  const bookId = 'book_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

  return {
    id: bookId,
    title: title.trim(),
    author: author.trim(),
    cover_data: coverData,
    chapters,
    files,
    current_chapter: 1,
    scroll_percent: 0,
    added_at: Math.floor(Date.now() / 1000)
  };
}

function resolveZipPath(base, rel) {
  if (!base) return rel.replace(/\\/g, '/');
  const parts = (base + '/' + rel).replace(/\\/g, '/').split('/');
  const stack = [];
  for (const p of parts) {
    if (p === '..') stack.pop();
    else if (p && p !== '.') stack.push(p);
  }
  return stack.join('/');
}

function cleanXhtml(raw) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, 'text/html');
  doc.querySelectorAll('script, style, iframe').forEach(el => el.remove());
  return doc.body ? doc.body.innerHTML : raw;
}
