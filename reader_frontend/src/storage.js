import JSZip from 'jszip';
import { encryptText, decryptText } from './crypto';

const DB_NAME = 'CuuUReaderDB';
const DB_VERSION = 2;
const STORE_BOOKS = 'books';
const STORE_AUTH = 'auth';
const STORE_META = 'meta';

// Initialize IndexedDB with multi-store support
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
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
    request.onerror = (e) => reject(e.target.error);
  });
}

// -----------------------------------------------------------------------------
// AUTH & MASTER PASSCODE STORAGE
// -----------------------------------------------------------------------------

export async function getAuthConfig() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUTH, 'readonly');
    const store = tx.objectStore(STORE_AUTH);
    const req = store.get('master_auth');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
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

// -----------------------------------------------------------------------------
// LAST READ PROGRESS TRACKING (TIẾP TỤC ĐỌC GẦN NHẤT)
// -----------------------------------------------------------------------------

export async function getLastReadSession() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const store = tx.objectStore(STORE_META);
    const req = store.get('last_read');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLastReadSession(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readwrite');
    const store = tx.objectStore(STORE_META);
    const req = store.put({
      id: 'last_read',
      ...data,
      updated_at: Date.now()
    });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// -----------------------------------------------------------------------------
// BOOK STORAGE WITH ZERO-KNOWLEDGE ENCRYPTION
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
        title: b.title,
        author: b.author,
        total_chapters: b.chapters.length,
        current_chapter: b.current_chapter || 1,
        scroll_percent: b.scroll_percent || 0,
        has_cover: !!b.cover_data,
        cover_url: b.cover_data || null,
        is_encrypted: !!b.is_encrypted,
        added_at: b.added_at
      }));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getBookFromDB(id, cryptoKey = null) {
  const db = await openDB();
  const book = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BOOKS, 'readonly');
    const store = tx.objectStore(STORE_BOOKS);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!book) return null;

  // If book files are encrypted, decrypt them with cryptoKey
  if (book.is_encrypted && cryptoKey && book.encrypted_files) {
    const decryptedFiles = {};
    for (const [href, encPayload] of Object.entries(book.encrypted_files)) {
      try {
        decryptedFiles[href] = await decryptText(encPayload, cryptoKey);
      } catch (e) {
        decryptedFiles[href] = '<p style="color:red">Lỗi giải mã chương. Mật khẩu không đúng.</p>';
      }
    }
    book.files = decryptedFiles;
  }

  return book;
}

export async function saveBookToDB(book, cryptoKey = null) {
  const db = await openDB();

  // If cryptoKey is provided, encrypt every chapter before saving to IndexedDB
  const bookToSave = { ...book };
  if (cryptoKey && book.files) {
    const encryptedFiles = {};
    for (const [href, plainHtml] of Object.entries(book.files)) {
      encryptedFiles[href] = await encryptText(plainHtml, cryptoKey);
    }
    bookToSave.encrypted_files = encryptedFiles;
    bookToSave.is_encrypted = true;
    delete bookToSave.files; // Do not store plaintext in IndexedDB!
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BOOKS, 'readwrite');
    const store = tx.objectStore(STORE_BOOKS);
    const req = store.put(bookToSave);
    req.onsuccess = () => resolve(book);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteBookFromDB(id) {
  const db = await openDB();
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
  return new Promise((resolve, reject) => {
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
    req.onerror = () => reject(req.error);
  });
}

// -----------------------------------------------------------------------------
// CLIENT-SIDE EPUB PARSER
// -----------------------------------------------------------------------------

export async function parseEpubClient(file) {
  const zip = await JSZip.loadAsync(file);

  const containerXmlStr = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXmlStr) throw new Error('File không hợp lệ: Thiếu META-INF/container.xml');

  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXmlStr, 'application/xml');
  const rootfileEl = containerDoc.querySelector('rootfile');
  const opfPath = rootfileEl?.getAttribute('full-path');
  if (!opfPath) throw new Error('Không tìm thấy đường dẫn content.opf');

  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : '';

  const opfXmlStr = await zip.file(opfPath)?.async('text');
  if (!opfXmlStr) throw new Error('Không tìm thấy file ' + opfPath);

  const opfDoc = parser.parseFromString(opfXmlStr, 'application/xml');
  const title = opfDoc.querySelector('title')?.textContent || file.name.replace(/\.epub$/i, '');
  const author = opfDoc.querySelector('creator')?.textContent || 'Khuyết danh';

  const manifest = {};
  opfDoc.querySelectorAll('manifest item').forEach(item => {
    manifest[item.getAttribute('id')] = item.getAttribute('href');
  });

  let coverData = null;
  const coverMeta = opfDoc.querySelector('meta[name="cover"]');
  let coverHref = null;
  if (coverMeta) {
    coverHref = manifest[coverMeta.getAttribute('content')];
  }
  if (!coverHref) {
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
