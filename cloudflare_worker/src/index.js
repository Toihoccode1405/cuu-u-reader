import JSZip from 'jszip';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// -----------------------------------------------------------------------------
// CRYPTO HELPERS (WEB CRYPTO API)
// -----------------------------------------------------------------------------

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: 50000,
      hash: 'SHA-256',
    },
    key,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

const JWT_SECRET = 'cuu_u_reader_secret_key_2026';

async function generateToken(userId, username) {
  const payload = `${userId}:${username}:${Date.now()}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const sigHex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return btoa(`${payload}:${sigHex}`);
}

async function verifyToken(token) {
  try {
    const raw = atob(token);
    const parts = raw.split(':');
    if (parts.length !== 4) return null;
    const [userId, username, ts, sigHex] = parts;
    const payload = `${userId}:${username}:${ts}`;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = new Uint8Array(sigHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
    if (!valid) return null;

    return { userId, username };
  } catch (e) {
    return null;
  }
}

// -----------------------------------------------------------------------------
// MAIN WORKER HANDLER
// -----------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    const path = url.pathname;

    // Route static frontend requests (SPA) to Cloudflare Assets
    if (!path.startsWith('/api')) {
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return new Response('Not Found', { status: 404 });
    }

    if (!env.DB) {
      return errorResponse('Chưa liên kết cơ sở dữ liệu Cloudflare D1', 500);
    }
    await initTables(env.DB);

    // 1. Auth: Register
    if (path === '/api/auth/register' && request.method === 'POST') {
      const { username, password } = await request.json();
      if (!username || !password || username.length < 3 || password.length < 4) {
        return errorResponse('Tài khoản ít nhất 3 ký tự, mật khẩu ít nhất 4 ký tự');
      }

      const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
        .bind(username.toLowerCase().trim())
        .first();

      if (existing) {
        return errorResponse('Tên tài khoản này đã được sử dụng');
      }

      const userId = 'u_' + crypto.randomUUID();
      const salt = 'salt_' + userId;
      const hash = await hashPassword(password, salt);

      await env.DB.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .bind(userId, username.toLowerCase().trim(), hash, Date.now())
        .run();

      const token = await generateToken(userId, username.trim());
      return jsonResponse({
        token,
        user: { id: userId, username: username.trim() }
      });
    }

    // 2. Auth: Login
    if (path === '/api/auth/login' && request.method === 'POST') {
      const { username, password } = await request.json();
      const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?')
        .bind(username.toLowerCase().trim())
        .first();

      if (!user) {
        return errorResponse('Tài khoản hoặc mật khẩu không chính xác');
      }

      const salt = 'salt_' + user.id;
      const hash = await hashPassword(password, salt);

      if (hash !== user.password_hash) {
        return errorResponse('Tài khoản hoặc mật khẩu không chính xác');
      }

      const token = await generateToken(user.id, user.username);
      return jsonResponse({
        token,
        user: { id: user.id, username: user.username }
      });
    }

    // Auth Middleware for all protected /api/ routes
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const userSession = token ? await verifyToken(token) : null;

    if (!userSession && path.startsWith('/api/books')) {
      return errorResponse('Chưa đăng nhập. Vui lòng đăng nhập để đồng bộ kho sách.', 401);
    }

    const userId = userSession?.userId;

    // 3. Books: List books
    if (path === '/api/books' && request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT id, title, author, total_chapters, current_chapter, scroll_percent, has_cover, added_at FROM books WHERE user_id = ? ORDER BY added_at DESC'
      ).bind(userId).all();

      return jsonResponse(results || []);
    }

    // 4. Books: Upload EPUB
    if (path === '/api/books/upload' && request.method === 'POST') {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file) return errorResponse('Thiếu file EPUB');

      const fileBuffer = await file.arrayBuffer();
      const bookId = 'b_' + crypto.randomUUID();

      const zip = await JSZip.loadAsync(fileBuffer);
      const metadata = await parseEpubFull(zip, file.name);

      let hasCover = 0;
      if (metadata.coverBase64) {
        await env.DB.prepare('INSERT OR REPLACE INTO covers (book_id, cover_data) VALUES (?, ?)')
          .bind(bookId, metadata.coverBase64)
          .run();
        hasCover = 1;
      }

      // Save book record
      await env.DB.prepare(
        'INSERT INTO books (id, user_id, title, author, total_chapters, current_chapter, scroll_percent, has_cover, chapters_json, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        bookId,
        userId,
        metadata.title,
        metadata.author,
        metadata.chapters.length,
        1,
        0,
        hasCover,
        JSON.stringify(metadata.chapters.map(c => ({ index: c.index, title: c.title }))),
        Date.now()
      ).run();

      // Save chapters in batches to D1
      const batchStatements = [];
      for (const ch of metadata.chapters) {
        batchStatements.push(
          env.DB.prepare('INSERT INTO chapters (book_id, chapter_index, title, content) VALUES (?, ?, ?, ?)')
            .bind(bookId, ch.index, ch.title, ch.content)
        );
      }

      // D1 supports batch execution up to 100 statements
      for (let i = 0; i < batchStatements.length; i += 80) {
        await env.DB.batch(batchStatements.slice(i, i + 80));
      }

      return jsonResponse({
        id: bookId,
        title: metadata.title,
        author: metadata.author,
        total_chapters: metadata.chapters.length,
        current_chapter: 1,
        scroll_percent: 0,
        has_cover: !!hasCover,
        added_at: Date.now()
      });
    }

    // 5. Books: Get Detail & TOC
    const matchDetail = path.match(/^\/api\/books\/([^\/]+)$/);
    if (matchDetail && request.method === 'GET') {
      const bookId = matchDetail[1];
      const record = await env.DB.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?')
        .bind(bookId, userId)
        .first();

      if (!record) return errorResponse('Không tìm thấy sách', 404);

      const chapters = JSON.parse(record.chapters_json || '[]');
      return jsonResponse({
        record: {
          id: record.id,
          title: record.title,
          author: record.author,
          total_chapters: record.total_chapters,
          current_chapter: record.current_chapter,
          scroll_percent: record.scroll_percent,
          has_cover: !!record.has_cover,
          added_at: record.added_at
        },
        chapters
      });
    }

    // 6. Books: Get Chapter Content
    const matchChapter = path.match(/^\/api\/books\/([^\/]+)\/chapters\/(\d+)$/);
    if (matchChapter && request.method === 'GET') {
      const bookId = matchChapter[1];
      const chapterIdx = parseInt(matchChapter[2]);

      const record = await env.DB.prepare('SELECT total_chapters FROM books WHERE id = ? AND user_id = ?')
        .bind(bookId, userId)
        .first();

      if (!record) return errorResponse('Không tìm thấy sách', 404);

      const chapterRow = await env.DB.prepare(
        'SELECT title, content FROM chapters WHERE book_id = ? AND chapter_index = ?'
      ).bind(bookId, chapterIdx).first();

      if (!chapterRow) return errorResponse('Chương không tồn tại', 404);

      return jsonResponse({
        book_id: bookId,
        chapter_index: chapterIdx,
        title: chapterRow.title,
        content_html: chapterRow.content,
        total_chapters: record.total_chapters,
        prev_index: chapterIdx > 1 ? chapterIdx - 1 : null,
        next_index: chapterIdx < record.total_chapters ? chapterIdx + 1 : null
      });
    }

    // 7. Books: Update Progress
    const matchProgress = path.match(/^\/api\/books\/([^\/]+)\/progress$/);
    if (matchProgress && request.method === 'POST') {
      const bookId = matchProgress[1];
      const { chapter_index, scroll_percent, chapter_title, book_title } = await request.json();

      await env.DB.prepare(
        'UPDATE books SET current_chapter = ?, scroll_percent = ? WHERE id = ? AND user_id = ?'
      ).bind(chapter_index, scroll_percent, bookId, userId).run();

      await env.DB.prepare(`
        INSERT INTO progress (user_id, book_id, book_title, chapter_index, chapter_title, scroll_percent, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, book_id) DO UPDATE SET
          chapter_index = excluded.chapter_index,
          chapter_title = excluded.chapter_title,
          scroll_percent = excluded.scroll_percent,
          updated_at = excluded.updated_at
      `).bind(userId, bookId, book_title || 'Sách', chapter_index, chapter_title || `Chương ${chapter_index}`, scroll_percent, Date.now()).run();

      return jsonResponse({ success: true });
    }

    // 8. Last Read
    if (path === '/api/last-read' && request.method === 'GET') {
      const last = await env.DB.prepare(
        'SELECT * FROM progress WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1'
      ).bind(userId).first();

      return jsonResponse(last || null);
    }

    // 9. Cover Image Stream from D1
    const matchCover = path.match(/^\/api\/books\/([^\/]+)\/cover$/);
    if (matchCover && request.method === 'GET') {
      const bookId = matchCover[1];
      const row = await env.DB.prepare('SELECT cover_data FROM covers WHERE book_id = ?').bind(bookId).first();
      if (!row || !row.cover_data) return new Response('Cover not found', { status: 404 });

      // cover_data is data:image/...;base64,...
      const match = row.cover_data.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match) {
        const mime = match[1];
        const binary = atob(match[2]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const headers = new Headers(CORS_HEADERS);
        headers.set('Content-Type', mime);
        headers.set('Cache-Control', 'public, max-age=31536000');
        return new Response(bytes, { headers });
      }

      return new Response('Invalid cover data', { status: 500 });
    }

    // 10. Delete Book
    if (matchDetail && request.method === 'DELETE') {
      const bookId = matchDetail[1];
      await env.DB.prepare('DELETE FROM books WHERE id = ? AND user_id = ?').bind(bookId, userId).run();
      await env.DB.prepare('DELETE FROM chapters WHERE book_id = ?').bind(bookId).run();
      await env.DB.prepare('DELETE FROM covers WHERE book_id = ?').bind(bookId).run();
      await env.DB.prepare('DELETE FROM progress WHERE book_id = ? AND user_id = ?').bind(bookId, userId).run();
      return jsonResponse({ success: true });
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  }
};

// -----------------------------------------------------------------------------
// D1 DATABASE SCHEMA INITIALIZATION
// -----------------------------------------------------------------------------

async function initTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      total_chapters INTEGER NOT NULL,
      current_chapter INTEGER DEFAULT 1,
      scroll_percent REAL DEFAULT 0,
      has_cover INTEGER DEFAULT 0,
      chapters_json TEXT NOT NULL,
      added_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS covers (
      book_id TEXT PRIMARY KEY,
      cover_data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chapters (
      book_id TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      PRIMARY KEY (book_id, chapter_index)
    );
    CREATE TABLE IF NOT EXISTS progress (
      user_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      book_title TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      chapter_title TEXT NOT NULL,
      scroll_percent REAL NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, book_id)
    );
  `);
}

// -----------------------------------------------------------------------------
// FULL EPUB EXTRACTOR
// -----------------------------------------------------------------------------

function findZipFile(zip, filename) {
  if (!filename) return null;
  const target = filename.toLowerCase().replace(/\\/g, '/');
  if (zip.files[filename]) return zip.files[filename];
  for (const name of Object.keys(zip.files)) {
    if (name.toLowerCase().replace(/\\/g, '/') === target) return zip.files[name];
  }
  for (const name of Object.keys(zip.files)) {
    if (name.toLowerCase().replace(/\\/g, '/').endsWith(target)) return zip.files[name];
  }
  return null;
}

function getTagText(xml, tagName) {
  if (!xml) return '';
  const re = new RegExp('<(?:[a-zA-Z0-9_-]+:)?' + tagName + '[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9_-]+:)?' + tagName + '>', 'i');
  const m = xml.match(re);
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim() : '';
}

async function parseEpubFull(zip, fallbackName) {
  const containerFile = findZipFile(zip, 'META-INF/container.xml');
  const containerXml = await containerFile.async('text');
  const m_root = containerXml.match(/full-path=['"]([^'"]+)['"]/i);
  const opfPath = m_root ? m_root[1].trim() : 'OEBPS/content.opf';
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : '';

  const opfFile = findZipFile(zip, opfPath);
  const opfXml = await opfFile.async('text');

  const title = getTagText(opfXml, 'title') || fallbackName.replace(/\.epub$/i, '');
  const author = getTagText(opfXml, 'creator') || 'Khuyết danh';

  const manifest = {};
  const itemRegex = /<item\s+[^>]*>/gi;
  let match;
  while ((match = itemRegex.exec(opfXml)) !== null) {
    const itemTag = match[0];
    const idM = itemTag.match(/id=['"]([^'"]+)['"]/i);
    const hrefM = itemTag.match(/href=['"]([^'"]+)['"]/i);
    if (idM && hrefM) manifest[idM[1]] = hrefM[1].trim();
  }

  // Cover image
  let coverBase64 = null;
  let coverHref = null;
  const coverMeta = opfXml.match(/<meta\s+[^>]*name=['"]cover['"][^>]*content=['"]([^'"]+)['"]/i);
  if (coverMeta && manifest[coverMeta[1]]) coverHref = manifest[coverMeta[1]];
  if (!coverHref) {
    for (const [id, href] of Object.entries(manifest)) {
      if ((id.toLowerCase().includes('cover') || href.toLowerCase().includes('cover')) && /\.(jpe?g|png|webp)$/i.test(href)) {
        coverHref = href;
        break;
      }
    }
  }
  if (coverHref) {
    const coverFile = findZipFile(zip, opfDir ? `${opfDir}/${coverHref}` : coverHref);
    if (coverFile) {
      const b64 = await coverFile.async('base64');
      const ext = coverHref.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
      coverBase64 = `data:image/${ext};base64,${b64}`;
    }
  }

  // TOC
  let chapters = [];
  let ncxHref = null;
  for (const [id, href] of Object.entries(manifest)) {
    if (id.toLowerCase().includes('ncx') || href.toLowerCase().endsWith('.ncx')) {
      ncxHref = href;
      break;
    }
  }
  if (ncxHref) {
    const ncxFile = findZipFile(zip, opfDir ? `${opfDir}/${ncxHref}` : ncxHref);
    if (ncxFile) {
      const ncxXml = await ncxFile.async('text');
      const navPointRegex = /<navPoint[\s\S]*?<\/navPoint>/gi;
      let npMatch, idx = 1;
      while ((npMatch = navPointRegex.exec(ncxXml)) !== null) {
        const npXml = npMatch[0];
        const chTitle = getTagText(npXml, 'text') || `Chương ${idx}`;
        const srcM = npXml.match(/<content\s+[^>]*src=['"]([^'"]+)['"]/i);
        if (srcM) {
          const cleanSrc = srcM[1].split('#')[0].trim();
          const fullSrc = (opfDir ? `${opfDir}/${cleanSrc}` : cleanSrc).replace(/\\/g, '/');
          const chFile = findZipFile(zip, fullSrc);
          const rawContent = chFile ? await chFile.async('text') : '<p>Chương trống.</p>';
          chapters.push({
            index: idx,
            title: chTitle,
            content: cleanXhtml(rawContent)
          });
          idx++;
        }
      }
    }
  }

  return { title, author, coverBase64, chapters };
}

function cleanXhtml(raw) {
  let bodyContent = raw;
  const bodyM = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyM) bodyContent = bodyM[1];
  return bodyContent
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
}
