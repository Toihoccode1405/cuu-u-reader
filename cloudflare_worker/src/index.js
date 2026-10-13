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

    try {
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
    // Auth: Check me
    if (path === '/api/auth/me' && request.method === 'GET') {
      if (!userSession) return errorResponse('Phiên đăng nhập hết hạn', 401);
      return jsonResponse({ user: userSession });
    }
    // Allow public access to cover images (HTML <img> tag cannot send Authorization headers)
    const isCoverRequest = /^\/api\/books\/[^\/]+\/cover$/.test(path);

    if (!isCoverRequest && !userSession && (path.startsWith('/api/books') || path.startsWith('/api/history') || path.startsWith('/api/last-read'))) {
      return errorResponse('Chưa đăng nhập. Vui lòng đăng nhập để sử dụng.', 401);
    }

    const userId = userSession?.userId;

    // 3. Books: List books
    if (path === '/api/books' && request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT id, title, author, total_chapters, current_chapter, scroll_percent, para_index, has_cover, added_at FROM books WHERE user_id = ? ORDER BY added_at DESC'
      ).bind(userId).all();

      return jsonResponse(results || []);
    }

    // 4. Books: Upload EPUB
    // 4. Books: Upload EPUB (Chunked Zero-Timeout Architecture)
    if (path === '/api/books/upload' && request.method === 'POST') {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file) return errorResponse('Thiếu file EPUB');

      const fileBuffer = await file.arrayBuffer();
      const bookId = 'b_' + crypto.randomUUID();

      // Fast metadata extraction (NCX / Spine only - sub 100ms)
      const zip = await JSZip.loadAsync(fileBuffer);
      const metadata = await parseEpubMetadataOnly(zip, file.name);

      let hasCover = 0;
      if (metadata.coverBase64 && metadata.coverBase64.length < 80000) {
        await env.DB.prepare('INSERT OR REPLACE INTO covers (book_id, cover_data) VALUES (?, ?)')
          .bind(bookId, metadata.coverBase64)
          .run();
        hasCover = 1;
      }

      // Save book record
      await env.DB.prepare(
        'INSERT INTO books (id, user_id, title, author, total_chapters, current_chapter, scroll_percent, has_cover, chapters_json, added_at, toc_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        bookId,
        userId,
        metadata.title,
        metadata.author,
        metadata.chapters.length,
        1,
        0,
        hasCover,
        JSON.stringify(metadata.chapters.map(c => ({ index: c.index, title: c.title, href: c.href }))),
        Date.now(),
        TOC_VERSION
      ).run();

      // Save raw EPUB in 60KB chunks to bypass D1 SQL length limits
      const CHUNK_SIZE = 60 * 1024;
      const uint8 = new Uint8Array(fileBuffer);
      const totalChunks = Math.ceil(uint8.length / CHUNK_SIZE);
      const chunkStatements = [];

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(uint8.length, start + CHUNK_SIZE);
        const slice = uint8.subarray(start, end);
        let binary = '';
        const slen = slice.byteLength;
        for (let j = 0; j < slen; j++) binary += String.fromCharCode(slice[j]);
        const b64 = btoa(binary);

        chunkStatements.push(
          env.DB.prepare('INSERT INTO book_chunks (book_id, chunk_index, data) VALUES (?, ?, ?)')
            .bind(bookId, i, b64)
        );
      }

      for (let i = 0; i < chunkStatements.length; i += 80) {
        await env.DB.batch(chunkStatements.slice(i, i + 80));
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

    // 4.1 Books: Download EPUB file stream
    const matchFile = path.match(/^\/api\/books\/([^\/]+)\/file$/);
    if (matchFile && request.method === 'GET') {
      const bookId = matchFile[1];
      const { results } = await env.DB.prepare(
        'SELECT chunk_index, data FROM book_chunks WHERE book_id = ? ORDER BY chunk_index ASC'
      ).bind(bookId).all();

      if (!results || results.length === 0) return errorResponse('File not found', 404);

      let totalLen = 0;
      const buffers = results.map(row => {
        const bin = atob(row.data);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        totalLen += u8.length;
        return u8;
      });

      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const b of buffers) {
        merged.set(b, offset);
        offset += b.length;
      }

      return new Response(merged, {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/epub+zip',
          'Content-Disposition': `attachment; filename="${bookId}.epub"`,
          'Cache-Control': 'public, max-age=86400'
        }
      });
    }

    // 5. Books: Get Detail & TOC
    const matchDetail = path.match(/^\/api\/books\/([^\/]+)$/);
    if (matchDetail && request.method === 'GET') {
      const bookId = matchDetail[1];
      let record = await env.DB.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?')
        .bind(bookId, userId)
        .first();

      if (!record) return errorResponse('Không tìm thấy sách', 404);

      // Self-heal books indexed by an older TOC parser (dropped #anchors -> wrong chapter)
      if ((record.toc_version || 0) < TOC_VERSION) {
        const repaired = await reindexBook(env, record);
        if (repaired) {
          record = await env.DB.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?')
            .bind(bookId, userId)
            .first();
        }
      }

      const chapters = JSON.parse(record.chapters_json || '[]');
      return jsonResponse({
        record: {
          id: record.id,
          title: record.title,
          author: record.author,
          total_chapters: record.total_chapters,
          current_chapter: record.current_chapter,
          scroll_percent: record.scroll_percent,
          para_index: record.para_index || 0,
          focus_para: record.focus_para ?? -1,
          focus_chapter: record.focus_chapter ?? -1,
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

      const record = await env.DB.prepare('SELECT total_chapters, chapters_json FROM books WHERE id = ? AND user_id = ?')
        .bind(bookId, userId)
        .first();

      if (!record) return errorResponse('Không tìm thấy sách', 404);

      const chapterRow = await env.DB.prepare(
        'SELECT title, content FROM chapters WHERE book_id = ? AND chapter_index = ?'
      ).bind(bookId, chapterIdx).first();

      let title = `Chương ${chapterIdx}`;
      let content_html = '';

      if (chapterRow) {
        title = chapterRow.title;
        content_html = chapterRow.content;
      } else {
        // Extract chapter on-the-fly from book_chunks (sub-50ms)
        const { results: chunkRows } = await env.DB.prepare(
          'SELECT data FROM book_chunks WHERE book_id = ? ORDER BY chunk_index ASC'
        ).bind(bookId).all();

        if (chunkRows && chunkRows.length > 0) {
          let totalLen = 0;
          const buffers = chunkRows.map(row => {
            const bin = atob(row.data);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            totalLen += u8.length;
            return u8;
          });
          const merged = new Uint8Array(totalLen);
          let offset = 0;
          for (const b of buffers) {
            merged.set(b, offset);
            offset += b.length;
          }

          const toc = JSON.parse(record.chapters_json || '[]');
          const targetCh = toc.find(c => c.index === chapterIdx);
          title = targetCh?.title || `Chương ${chapterIdx}`;

          const zip = await JSZip.loadAsync(merged);
          content_html = await extractChapterContent(zip, toc, chapterIdx, targetCh);
          content_html = stripDuplicateHeading(content_html, title);
        }
      }

      return jsonResponse({
        book_id: bookId,
        chapter_index: chapterIdx,
        title,
        content_html: content_html || '<p>Chương trống.</p>',
        total_chapters: record.total_chapters,
        prev_index: chapterIdx > 1 ? chapterIdx - 1 : null,
        next_index: chapterIdx < record.total_chapters ? chapterIdx + 1 : null
      });
    }
    // 7. Books: Update Progress
    const matchProgress = path.match(/^\/api\/books\/([^\/]+)\/progress$/);
    if (matchProgress && request.method === 'POST') {
      const bookId = matchProgress[1];
      const { chapter_index, scroll_percent, chapter_title, book_title, para_index, focus_para, focus_chapter } = await request.json();

      let resolvedTitle = book_title;
      if (!resolvedTitle || resolvedTitle === 'Sách') {
        const bRow = await env.DB.prepare('SELECT title FROM books WHERE id = ?').bind(bookId).first();
        resolvedTitle = bRow?.title || 'Sách';
      }

      const paraIdx = Number.isFinite(para_index) ? para_index : 0;
      const focusIdx = Number.isFinite(focus_para) ? focus_para : -1;
      // -1 = không ghim; ngược lại ghim gắn với đúng chương đang đọc
      const focusChap = Number.isFinite(focus_chapter)
        ? focus_chapter
        : (focusIdx >= 0 ? chapter_index : -1);

      await env.DB.prepare(
        'UPDATE books SET current_chapter = ?, scroll_percent = ?, para_index = ?, focus_para = ?, focus_chapter = ? WHERE id = ? AND user_id = ?'
      ).bind(chapter_index, scroll_percent, paraIdx, focusIdx, focusChap, bookId, userId).run();

      await env.DB.prepare(`
        INSERT INTO progress (user_id, book_id, book_title, chapter_index, chapter_title, scroll_percent, para_index, focus_para, focus_chapter, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, book_id) DO UPDATE SET
          book_title = excluded.book_title,
          chapter_index = excluded.chapter_index,
          chapter_title = excluded.chapter_title,
          scroll_percent = excluded.scroll_percent,
          para_index = excluded.para_index,
          focus_para = excluded.focus_para,
          focus_chapter = excluded.focus_chapter,
          updated_at = excluded.updated_at
      `).bind(userId, bookId, resolvedTitle, chapter_index, chapter_title || `Chương ${chapter_index}`, scroll_percent, paraIdx, focusIdx, focusChap, Date.now()).run();

      return jsonResponse({ success: true });
    }

    // 8. History: Full reading history for multiple books
    if (path === '/api/history' && request.method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT p.book_id, COALESCE(b.title, p.book_title) AS book_title, p.chapter_index, p.chapter_title, p.scroll_percent, p.para_index, p.focus_para, p.focus_chapter, p.updated_at,
               b.author, b.total_chapters, b.has_cover
        FROM progress p
        LEFT JOIN books b ON p.book_id = b.id
        WHERE p.user_id = ?
        ORDER BY p.updated_at DESC
        LIMIT 20
      `).bind(userId).all();

      return jsonResponse(results || []);
    }

    // 8.1 Bookmarks: list / create / delete (Cờ đánh dấu vị trí đọc)
    const matchBookmarks = path.match(/^\/api\/books\/([^\/]+)\/bookmarks$/);
    if (matchBookmarks) {
      const bookId = matchBookmarks[1];

      if (request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, chapter_index, para_index, scroll_percent, excerpt, note, created_at FROM bookmarks WHERE user_id = ? AND book_id = ? ORDER BY chapter_index ASC, para_index ASC'
        ).bind(userId, bookId).all();

        return jsonResponse(results || []);
      }

      if (request.method === 'POST') {
        const { chapter_index, para_index, scroll_percent, excerpt, note } = await request.json();
        if (!Number.isFinite(chapter_index) || !Number.isFinite(para_index)) {
          return errorResponse('Thiếu vị trí đánh dấu');
        }

        const existing = await env.DB.prepare(
          'SELECT id FROM bookmarks WHERE user_id = ? AND book_id = ? AND chapter_index = ? AND para_index = ?'
        ).bind(userId, bookId, chapter_index, para_index).first();

        if (existing) {
          await env.DB.prepare('DELETE FROM bookmarks WHERE id = ?').bind(existing.id).run();
          return jsonResponse({ success: true, removed: true, id: existing.id });
        }

        const bmId = 'bm_' + crypto.randomUUID();
        await env.DB.prepare(
          'INSERT INTO bookmarks (id, user_id, book_id, chapter_index, para_index, scroll_percent, excerpt, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          bmId, userId, bookId, chapter_index, para_index,
          scroll_percent || 0, (excerpt || '').slice(0, 240), (note || '').slice(0, 240), Date.now()
        ).run();

        return jsonResponse({ success: true, removed: false, id: bmId });
      }

      if (request.method === 'DELETE') {
        const { id } = await request.json();
        if (id) {
          await env.DB.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?').bind(id, userId).run();
        } else {
          await env.DB.prepare('DELETE FROM bookmarks WHERE user_id = ? AND book_id = ?').bind(userId, bookId).run();
        }
        return jsonResponse({ success: true });
      }
    }

    // 9. Last Read (Latest active book)
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
      await env.DB.prepare('DELETE FROM book_chunks WHERE book_id = ?').bind(bookId).run();
      await env.DB.prepare('DELETE FROM covers WHERE book_id = ?').bind(bookId).run();
      await env.DB.prepare('DELETE FROM bookmarks WHERE book_id = ? AND user_id = ?').bind(bookId, userId).run();
      await env.DB.prepare('DELETE FROM progress WHERE book_id = ? AND user_id = ?').bind(bookId, userId).run();
    }

      return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
    } catch (err) {
      console.error('API Error:', err);
      return errorResponse(err.message || 'Lỗi xử lý máy chủ', 500);
    }
  }
};

// -----------------------------------------------------------------------------
// D1 DATABASE SCHEMA INITIALIZATION
// -----------------------------------------------------------------------------

let tablesInitialized = false;

async function initTables(db) {
  if (tablesInitialized) return;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        total_chapters INTEGER NOT NULL,
        current_chapter INTEGER DEFAULT 1,
        scroll_percent REAL DEFAULT 0,
        para_index INTEGER DEFAULT 0,
        has_cover INTEGER DEFAULT 0,
        chapters_json TEXT NOT NULL,
        added_at INTEGER NOT NULL
      )
    `).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        book_id TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        para_index INTEGER NOT NULL,
        scroll_percent REAL DEFAULT 0,
        excerpt TEXT,
        note TEXT,
        created_at INTEGER NOT NULL
      )
    `).run();
    await db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_bookmarks_user_book ON bookmarks (user_id, book_id)'
    ).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS covers (
        book_id TEXT PRIMARY KEY,
        cover_data TEXT NOT NULL
      )
    `).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS chapters (
        book_id TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        PRIMARY KEY (book_id, chapter_index)
      )
    `).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS progress (
        user_id TEXT NOT NULL,
        book_id TEXT NOT NULL,
        book_title TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        chapter_title TEXT NOT NULL,
        scroll_percent REAL NOT NULL,
        para_index INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, book_id)
      )
    `).run();
    tablesInitialized = true;
  } catch (e) {
    console.error('initTables error:', e);
  }
}

// -----------------------------------------------------------------------------
// FULL EPUB EXTRACTOR
// -----------------------------------------------------------------------------

// EPUBs often pack many chapters into one XHTML file and address each chapter
// with a fragment anchor (#filepos...). The chapter slice runs from its own
// anchor to the next chapter anchor inside the same file.
const TOC_VERSION = 2;

function anchorOffset(html, anchor) {
  if (!anchor) return -1;
  let pos = -1;
  for (const p of [`id="${anchor}"`, `id='${anchor}'`, `name="${anchor}"`, `name='${anchor}'`]) {
    const i = html.indexOf(p);
    if (i >= 0 && (pos < 0 || i < pos)) pos = i;
  }
  if (pos < 0) return -1;
  const lt = html.lastIndexOf('<', pos);
  return lt >= 0 ? lt : pos;
}

function splitHref(href) {
  const raw = (href || '').trim();
  const hashAt = raw.indexOf('#');
  if (hashAt < 0) return { file: raw.replace(/\\/g, '/'), anchor: '' };
  return {
    file: raw.slice(0, hashAt).replace(/\\/g, '/'),
    anchor: raw.slice(hashAt + 1)
  };
}

async function reindexBook(env, record) {
  try {
    const { results: chunkRows } = await env.DB.prepare(
      'SELECT data FROM book_chunks WHERE book_id = ? ORDER BY chunk_index ASC'
    ).bind(record.id).all();

    if (!chunkRows || chunkRows.length === 0) {
      await env.DB.prepare('UPDATE books SET toc_version = ? WHERE id = ?').bind(TOC_VERSION, record.id).run();
      return false;
    }

    let totalLen = 0;
    const buffers = chunkRows.map(row => {
      const bin = atob(row.data);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      totalLen += u8.length;
      return u8;
    });
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const b of buffers) {
      merged.set(b, offset);
      offset += b.length;
    }

    const zip = await JSZip.loadAsync(merged);
    const metadata = await parseEpubMetadataOnly(zip, `${record.title}.epub`);
    if (!metadata.chapters || metadata.chapters.length === 0) {
      await env.DB.prepare('UPDATE books SET toc_version = ? WHERE id = ?').bind(TOC_VERSION, record.id).run();
      return false;
    }

    // Any chapter content cached by the old parser is invalid now.
    await env.DB.prepare('DELETE FROM chapters WHERE book_id = ?').bind(record.id).run();

    await env.DB.prepare(
      'UPDATE books SET chapters_json = ?, total_chapters = ?, toc_version = ? WHERE id = ?'
    ).bind(
      JSON.stringify(metadata.chapters.map(c => ({ index: c.index, title: c.title, href: c.href }))),
      metadata.chapters.length,
      TOC_VERSION,
      record.id
    ).run();

    return true;
  } catch (e) {
    console.error('reindexBook failed:', e);
    return false;
  }
}

async function extractChapterContent(zip, toc, chapterIdx, targetCh) {
  if (!targetCh || !targetCh.href) return '';

  const { file, anchor } = splitHref(targetCh.href);
  const chFile = findZipFile(zip, file);
  if (!chFile) return '';

  const raw = await chFile.async('text');

  if (!anchor) {
    return cleanXhtml(raw);
  }

  const start = anchorOffset(raw, anchor);

  // Nearest following chapter anchor inside the same file closes this chapter.
  let end = -1;
  for (const c of toc) {
    if (!c || c.index <= chapterIdx) continue;
    const other = splitHref(c.href);
    if (other.file !== file || !other.anchor) continue;
    const off = anchorOffset(raw, other.anchor);
    if (off > start && (end < 0 || off < end)) end = off;
  }

  const slice = end > start ? raw.slice(start, end) : (start >= 0 ? raw.slice(start) : raw);
  return cleanXhtml(slice);
}

function parseNcxEntries(ncxXml) {
  const tokens = [];
  const re = /<(\/?)navPoint\b[^>]*>/gi;
  let m;
  while ((m = re.exec(ncxXml)) !== null) {
    tokens.push({ close: m[1] === '/', from: m.index, to: m.index + m[0].length });
  }

  const entries = [];
  const stack = [];
  for (const t of tokens) {
    if (!t.close) {
      stack.push({ bodyFrom: t.to });
      continue;
    }
    const node = stack.pop();
    if (!node) continue;

    const body = ncxXml.slice(node.bodyFrom, t.from);

    const labelMatch = body.match(/<navLabel\b[^>]*>([\s\S]*?)<\/navLabel>/i);
    let title = '';
    if (labelMatch) {
      const textMatch = labelMatch[1].match(/<text\b[^>]*>([\s\S]*?)<\/text>/i);
      if (textMatch) title = decodeEntities(textMatch[1]).trim();
    }

    // A navPoint's own <content> always precedes any nested navPoint.
    const firstNested = body.search(/<navPoint\b/i);
    const own = firstNested >= 0 ? body.slice(0, firstNested) : body;
    const srcMatch = own.match(/<content\b[^>]*src\s*=\s*['"]([^'"]+)['"]/i);

    entries.push({ title, src: srcMatch ? srcMatch[1].trim() : null });
  }

  return entries;
}

function decodeEntities(s) {
  return (s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

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

async function parseEpubMetadataOnly(zip, fallbackName) {
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

  // TOC from NCX (depth-aware: pairs each navPoint's own label with its own src,
  // and keeps the fragment anchor that identifies the chapter inside a file)
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
      const entries = parseNcxEntries(ncxXml);
      const seen = new Set();
      let idx = 1;
      for (const e of entries) {
        if (!e.src) continue;
        const src = (opfDir ? `${opfDir}/${e.src}` : e.src).replace(/\\/g, '/');
        if (seen.has(src)) continue;
        seen.add(src);
        chapters.push({ index: idx, title: e.title || `Chương ${idx}`, href: src });
        idx++;
      }
    }
  }

  // Fallback: If no NCX or empty, read from spine
  if (chapters.length === 0) {
    const spineRegex = /<itemref\s+[^>]*idref=['"]([^'"]+)['"][^>]*>/gi;
    let sMatch, idx = 1;
    while ((sMatch = spineRegex.exec(opfXml)) !== null) {
      const idref = sMatch[1];
      const href = manifest[idref];
      if (href && /\.(x?html?|xml)$/i.test(href)) {
        const fullSrc = (opfDir ? `${opfDir}/${href}` : href).replace(/\\/g, '/');
        chapters.push({
          index: idx,
          title: `Chương ${idx}`,
          href: fullSrc
        });
        idx++;
      }
    }
  }

  return { title, author, coverBase64, chapters };
}

// Chuẩn hoá HTML trích ra: bỏ thẻ định dạng/class/attr lạ của EPUB,
// dựng lại thành các đoạn <p> sạch để CSS của trình đọc kiểm soát hoàn toàn.
function cleanXhtml(raw) {
  let bodyContent = raw;
  const bodyM = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyM) bodyContent = bodyM[1];

  bodyContent = bodyContent
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<title[\s\S]*?<\/title>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<span\b[^>]*><\/span>/gi, '');

  const plain = (s) => (s || '')
    .replace(/<(font|strong|b)\b[^>]*>/gi, '')
    .replace(/<\/(font|strong|b)>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(i|em|u|a|small|big|sub|sup)\b[^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const paragraphs = [];
  const blockRe = /<(p|div|h1|h2|h3|h4|h5|h6)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(bodyContent)) !== null) {
    const text = plain(m[2]);
    if (text.length > 0) paragraphs.push(text);
  }

  // Fallback: không có thẻ khối nào (HTML phẳng) -> chia theo <br>
  if (paragraphs.length === 0) {
    bodyContent.split(/<br\s*\/?>/gi).forEach(chunk => {
      const text = plain(chunk);
      if (text.length > 0) paragraphs.push(text);
    });
  }

  return paragraphs.map(t => `<p>${t}</p>`).join('\n');
}

// So sánh tiêu đề đã bỏ dấu câu/khoảng trắng để phát hiện dòng tiêu đề lặp lại
function normalizeHeading(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[.,:;!?"'“”‘’()\[\]\-–—…]/g, '');
}

// Nhiều EPUB lặp lại tiêu đề chương ngay dòng đầu nội dung -> bỏ để không trùng với tiêu đề của trình đọc
function stripDuplicateHeading(html, chapterTitle) {
  if (!html || !chapterTitle) return html;
  const m = html.match(/^<p>([\s\S]*?)<\/p>\s*/);
  if (!m) return html;
  const first = normalizeHeading(m[1]);
  const title = normalizeHeading(chapterTitle);
  if (!first || !title) return html;
  if (first === title || (first.startsWith(title) && first.length <= title.length + 6)) {
    return html.slice(m[0].length);
  }
  return html;
}
