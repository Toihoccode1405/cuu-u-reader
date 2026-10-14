import JSZip from 'jszip';
import { encryptText, decryptText } from './crypto';

const DB_NAME = 'CuuUReaderDB';
const DB_VERSION = 3;
const STORE_BOOKS = 'books';
const STORE_AUTH = 'auth';
const STORE_META = 'meta';

// In-memory cache of opened zip archives for instant chapter switching
const zipCache = new Map();

// Helper: case-insensitive & slash-tolerant zip file lookup
export function findZipFile(zip, filename) {
  if (!filename) return null;
  const target = filename.toLowerCase().replace(/\\/g, '/');

  // 1. Exact match
  if (zip.files[filename]) return zip.files[filename];

  // 2. Case-insensitive exact normalized match
  for (const name of Object.keys(zip.files)) {
    if (name.toLowerCase().replace(/\\/g, '/') === target) {
      return zip.files[name];
    }
  }

  // 3. Normalized endsWith match
  for (const name of Object.keys(zip.files)) {
    if (name.toLowerCase().replace(/\\/g, '/').endsWith(target)) {
      return zip.files[name];
    }
  }

  // 4. Base filename only match
  const baseName = target.split('/').pop();
  if (baseName) {
    for (const name of Object.keys(zip.files)) {
      if (name.toLowerCase().split('/').pop() === baseName) {
        return zip.files[name];
      }
    }
  }

  return null;
}

// Robust XML helper that ignores namespaces and CDATA
function getTagText(xml, tagName) {
  if (!xml) return '';
  const re = new RegExp('<(?:[a-zA-Z0-9_-]+:)?' + tagName + '[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9_-]+:)?' + tagName + '>', 'i');
  const m = xml.match(re);
  if (!m) return '';
  let val = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();
  // unescape basic xml entities
  val = val.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return val;
}

// -----------------------------------------------------------------------------
// INDEXEDDB ENGINE
// -----------------------------------------------------------------------------

export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onblocked = () => {
      console.warn('IndexedDB upgrade blocked. Closing other tabs may be needed.');
    };

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        db.createObjectStore(STORE_BOOKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_AUTH)) {
        db.createObjectStore(STORE_AUTH, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'id' });
      }
    };

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error || new Error('Cannot open IndexedDB'));
  });
}

// -----------------------------------------------------------------------------
// AUTH & SETTINGS
// -----------------------------------------------------------------------------

export async function getAuthConfig() {
  const db = await openDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_AUTH, 'readonly');
      const store = tx.objectStore(STORE_AUTH);
      const req = store.get('master_auth');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

export async function saveAuthConfig(saltBase64, verifierBase64) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUTH, 'readwrite');
    const store = tx.objectStore(STORE_AUTH);
    const req = store.put({
      id: 'master_auth',
      salt: saltBase64,
      verifier: verifierBase64,
      created_at: Date.now()
    });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function getLastReadSession() {
  const db = await openDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const req = store.get('last_read');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

export async function saveLastReadSession(data) {
  const db = await openDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_META, 'readwrite');
      const store = tx.objectStore(STORE_META);
      const req = store.put({
        id: 'last_read',
        ...data,
        updated_at: Date.now()
      });
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

// -----------------------------------------------------------------------------
// BOOK STORAGE (HIGH PERFORMANCE BLOB STORAGE)
// -----------------------------------------------------------------------------

export async function getAllBooksFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BOOKS, 'readonly');
    const store = tx.objectStore(STORE_BOOKS);
    const req = store.getAll();

    req.onsuccess = () => {
      const list = (req.result || []).map(b => ({
        id: b.id,
        title: b.title || 'Chưa có tiêu đề',
        author: b.author || 'Khuyết danh',
        total_chapters: Array.isArray(b.chapters) ? b.chapters.length : 0,
        current_chapter: b.current_chapter || 1,
        scroll_percent: b.scroll_percent || 0,
        has_cover: !!b.cover_data,
        cover_url: b.cover_data || null,
        is_encrypted: !!b.is_encrypted,
        added_at: b.added_at || Date.now()
      }));
      resolve(list);
    };

    req.onerror = () => reject(req.error || new Error('Cannot load books'));
  });
}

export async function getBookFromDB(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BOOKS, 'readonly');
    const store = tx.objectStore(STORE_BOOKS);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveBookToDB(book) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BOOKS, 'readwrite');
    const store = tx.objectStore(STORE_BOOKS);
    const req = store.put(book);
    req.onsuccess = () => resolve(book);
    req.onerror = () => reject(req.error || new Error('Cannot save book to storage'));
  });
}

export async function deleteBookFromDB(id) {
  const db = await openDB();
  zipCache.delete(id);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BOOKS, 'readwrite');
    const store = tx.objectStore(STORE_BOOKS);
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function updateProgressInDB(id, chapterIndex, scrollPercent) {
  const db = await openDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_BOOKS, 'readwrite');
      const store = tx.objectStore(STORE_BOOKS);
      const req = store.get(id);
      req.onsuccess = () => {
        const book = req.result;
        if (book) {
          book.current_chapter = chapterIndex;
          book.scroll_percent = scrollPercent;
          store.put(book);
        }
        resolve(true);
      };
      req.onerror = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

// -----------------------------------------------------------------------------
// INSTANT CHAPTER LOADER FROM BLOB
// -----------------------------------------------------------------------------

export async function loadChapterFromEpubBlob(book, chapterIndex) {
  if (!book || !book.chapters || chapterIndex < 1 || chapterIndex > book.chapters.length) {
    throw new Error('Chỉ số chương không hợp lệ');
  }

  const chMeta = book.chapters[chapterIndex - 1];

  // 1. Get or create JSZip instance from cache
  let zip = zipCache.get(book.id);
  if (!zip) {
    if (!book.epub_blob) {
      throw new Error('Không tìm thấy file sách trong bộ nhớ thiết bị.');
    }
    zip = await JSZip.loadAsync(book.epub_blob);
    zipCache.set(book.id, zip);
  }

  // 2. Locate chapter file
  const chFile = findZipFile(zip, chMeta.href);
  if (!chFile) {
    throw new Error(`Không tìm thấy file chương (${chMeta.href}) bên trong file EPUB.`);
  }

  // 3. Read chapter content
  const rawHtml = await chFile.async('text');
  const cleanHtml = cleanChapterContent(rawHtml);

  return {
    book_id: book.id,
    chapter_index: chapterIndex,
    title: chMeta.title,
    content_html: cleanHtml,
    total_chapters: book.chapters.length,
    prev_index: chapterIndex > 1 ? chapterIndex - 1 : null,
    next_index: chapterIndex < book.chapters.length ? chapterIndex + 1 : null
  };
}

// -----------------------------------------------------------------------------
// PURE CLIENT-SIDE EPUB PARSER (ROBUST & RESILIENT)
// -----------------------------------------------------------------------------

export async function parseEpubClient(file) {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. Locate META-INF/container.xml
  const containerFile = findZipFile(zip, 'META-INF/container.xml');
  if (!containerFile) {
    throw new Error('File không hợp lệ: Không tìm thấy META-INF/container.xml');
  }
  const containerXml = await containerFile.async('text');

  // Extract rootfile full-path
  const m_root = containerXml.match(/full-path=[\x27"]([^\x27"]+)[\x27"]/i);
  if (!m_root) {
    throw new Error('Không tìm thấy đường dẫn content.opf trong container.xml');
  }
  const opfPath = m_root[1].trim();
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : '';

  // 2. Locate and parse content.opf
  const opfFile = findZipFile(zip, opfPath);
  if (!opfFile) {
    throw new Error(`Không tìm thấy file cấu hình sách: ${opfPath}`);
  }
  const opfXml = await opfFile.async('text');

  // Extract Title and Author
  let title = getTagText(opfXml, 'title') || file.name.replace(/\.epub$/i, '').trim();
  let author = getTagText(opfXml, 'creator') || 'Khuyết danh';

  // Extract Manifest items: <item id="..." href="..." .../>
  const manifest = {};
  const itemRegex = /<item\s+[^>]*>/gi;
  let match;
  while ((match = itemRegex.exec(opfXml)) !== null) {
    const itemTag = match[0];
    const idM = itemTag.match(/id=[\x27"]([^\x27"]+)[\x27"]/i);
    const hrefM = itemTag.match(/href=[\x27"]([^\x27"]+)[\x27"]/i);
    if (idM && hrefM) {
      manifest[idM[1]] = hrefM[1].trim();
    }
  }

  // Extract Spine items: <itemref idref="..." .../>
  const spine = [];
  const itemrefRegex = /<itemref\s+[^>]*>/gi;
  while ((match = itemrefRegex.exec(opfXml)) !== null) {
    const refTag = match[0];
    const idrefM = refTag.match(/idref=[\x27"]([^\x27"]+)[\x27"]/i);
    if (idrefM) {
      spine.push(idrefM[1].trim());
    }
  }

  // Extract Cover Image
  let coverData = null;
  let coverHref = null;
  const coverMeta = opfXml.match(/<meta\s+[^>]*name=[\x27"]cover[\x27"][^>]*content=[\x27"]([^\x27"]+)[\x27"]/i);
  if (coverMeta && manifest[coverMeta[1]]) {
    coverHref = manifest[coverMeta[1]];
  }
  if (!coverHref) {
    // Search for item with id or href containing 'cover'
    for (const [id, href] of Object.entries(manifest)) {
      if ((id.toLowerCase().includes('cover') || href.toLowerCase().includes('cover')) && /\.(jpe?g|png|webp)$/i.test(href)) {
        coverHref = href;
        break;
      }
    }
  }

  if (coverHref) {
    const fullCoverPath = opfDir ? `${opfDir}/${coverHref}` : coverHref;
    const coverFile = findZipFile(zip, fullCoverPath);
    if (coverFile) {
      try {
        const coverBase64 = await coverFile.async('base64');
        const ext = coverHref.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
        coverData = `data:image/${ext};base64,${coverBase64}`;
      } catch (e) {}
    }
  }

  // 3. Extract Table of Contents (NCX / NAV)
  let chapters = [];

  // Try finding NCX item in manifest
  let ncxHref = null;
  for (const [id, href] of Object.entries(manifest)) {
    if (id.toLowerCase().includes('ncx') || href.toLowerCase().endsWith('.ncx')) {
      ncxHref = href;
      break;
    }
  }

  if (ncxHref) {
    const ncxPath = opfDir ? `${opfDir}/${ncxHref}` : ncxHref;
    const ncxFile = findZipFile(zip, ncxPath);
    if (ncxFile) {
      try {
        const ncxXml = await ncxFile.async('text');
        const navPointRegex = /<navPoint[\s\S]*?<\/navPoint>/gi;
        let npMatch;
        let idx = 1;
        while ((npMatch = navPointRegex.exec(ncxXml)) !== null) {
          const npXml = npMatch[0];
          const chTitle = getTagText(npXml, 'text') || `Chương ${idx}`;
          const srcM = npXml.match(/<content\s+[^>]*src=[\x27"]([^\x27"]+)[\x27"]/i);
          if (srcM) {
            const cleanSrc = srcM[1].split('#')[0].trim();
            const fullSrc = opfDir ? `${opfDir}/${cleanSrc}` : cleanSrc;
            chapters.push({
              index: idx,
              title: chTitle,
              href: fullSrc.replace(/\\/g, '/')
            });
            idx++;
          }
        }
      } catch (e) {}
    }
  }

  // Fallback: If no NCX chapters, build from spine order
  if (chapters.length === 0 && spine.length > 0) {
    spine.forEach((idref, i) => {
      const href = manifest[idref];
      if (href) {
        const cleanHref = href.split('#')[0].trim();
        const fullHref = opfDir ? `${opfDir}/${cleanHref}` : cleanHref;
        chapters.push({
          index: i + 1,
          title: `Chương ${i + 1}`,
          href: fullHref.replace(/\\/g, '/')
        });
      }
    });
  }

  if (chapters.length === 0) {
    throw new Error('Không tìm thấy danh sách chương bên trong file EPUB này.');
  }

  const bookId = 'book_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

  return {
    id: bookId,
    title: title,
    author: author,
    cover_data: coverData,
    chapters: chapters,
    epub_blob: file, // Store the raw EPUB Blob directly in IndexedDB
    current_chapter: 1,
    scroll_percent: 0,
    added_at: Math.floor(Date.now() / 1000)
  };
}

function cleanChapterContent(raw) {
  if (!raw) return '<p>Nội dung trống.</p>';

  let bodyContent = raw;
  const bodyM = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyM) {
    bodyContent = bodyM[1];
  }

  bodyContent = bodyContent
    .replace(/<(script|style|iframe|object|embed|svg|math|form|base|meta|link|applet)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|svg|math|form|base|meta|link|applet)\b[^>]*>/gi, '');

  const plain = (s) => (s || '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gis, '')
    .replace(/\son\w+\s*=\s*[^ >]+/gis, '')
    .replace(/(href|src)\s*=\s*(['"])\s*(javascript|vbscript|data):.*?\2/gis, '')
    .replace(/<(?!\/?(i|em|b|strong|u|br)\b)[^>]*>/gi, '')
    .replace(/<(i|em|b|strong|u)\b[^>]*>/gi, '<$1>')
    .replace(/\s+/g, ' ')
    .trim();

  const paragraphs = [];
  const blockRe = /<(p|div|h1|h2|h3|h4|h5|h6)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(bodyContent)) !== null) {
    const text = plain(m[2]);
    if (text.length > 0) paragraphs.push(text);
  }

  if (paragraphs.length === 0) {
    bodyContent.split(/<br\s*\/?>/gi).forEach(chunk => {
      const text = plain(chunk);
      if (text.length > 0) paragraphs.push(text);
    });
  }

  return paragraphs.map(t => `<p>${t}</p>`).join('\n') || '<p>Nội dung trống.</p>';
}
