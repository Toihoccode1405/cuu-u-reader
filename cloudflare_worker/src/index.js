import JSZip from 'jszip';
import { extractChapterRaw, safeDecodeURI } from '../../shared/epub-chapter.js';
import { realmFor, paragraphWordCounts, MAX_WORDS_PER_SECOND, MAX_REPORT_SECONDS, MAX_TU_VI } from '../../shared/cultivation.js';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// Gắn header bảo mật cho MỌI phản hồi của Worker (API lẫn trang tĩnh nếu đi qua Worker).
function finalizeResponse(request, response) {
  const res = new Response(response.body, response);
  const h = res.headers;
  // Không bao giờ cấp CORS: giao diện và API cùng origin, và cookie phiên chỉ dùng trong origin này
  h.delete('Access-Control-Allow-Origin');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  const ct = h.get('Content-Type') || '';
  if (ct.includes('text/html')) h.set('Content-Security-Policy', CSP);
  if (ct.includes('application/json') && !h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
  return res;
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function errorResponse(msg, status = 400, extraHeaders = {}) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

// -----------------------------------------------------------------------------
// CRYPTO HELPERS (WEB CRYPTO API)
// -----------------------------------------------------------------------------

// Workers giới hạn PBKDF2 tối đa 100.000 vòng.
const PBKDF2_ITERATIONS = 100000;
const LEGACY_PBKDF2_ITERATIONS = 50000;

async function pbkdf2Hex(password, salt, iterations) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' },
    key,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Định dạng mới: "pbkdf2$<vòng lặp>$<hex>". Định dạng cũ (chỉ hex, 50.000 vòng) vẫn đăng nhập được
// và tự nâng cấp lên định dạng mới sau lần đăng nhập đúng.
async function hashPassword(password, salt) {
  const hex = await pbkdf2Hex(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hex}`;
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function verifyPassword(password, salt, stored) {
  if (typeof stored === 'string' && stored.startsWith('pbkdf2$')) {
    const [, iterStr, hex] = stored.split('$');
    const iterations = parseInt(iterStr, 10);
    if (!Number.isFinite(iterations) || iterations < 1000 || iterations > 100000) return { ok: false };
    const computed = await pbkdf2Hex(password, salt, iterations);
    return { ok: timingSafeEqual(computed, hex), needsUpgrade: iterations < PBKDF2_ITERATIONS };
  }
  const computed = await pbkdf2Hex(password, salt, LEGACY_PBKDF2_ITERATIONS);
  return { ok: timingSafeEqual(computed, stored), needsUpgrade: true };
}

// Khóa ký token BẮT BUỘC đặt qua `wrangler secret put JWT_SECRET` (không có giá trị mặc định).
function getJwtSecret(env) {
  const secret = env?.JWT_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

// Nội dung một chương: lấy từ bảng chapters nếu đã tách, nếu chưa thì tách từ EPUB rồi lưu lại
async function loadChapterContent(env, ctx, record, bookId, chapterIdx) {
  const chapterRow = await env.DB.prepare(
    'SELECT title, content FROM chapters WHERE book_id = ? AND chapter_index = ?'
  ).bind(bookId, chapterIdx).first();

  let title = `Chương ${chapterIdx}`;
  let content_html = '';

  if (chapterRow) {
    title = chapterRow.title;
    content_html = chapterRow.content;
  } else {
    // Extract chapter on-the-fly (EPUB lấy từ R2 hoặc book_chunks, có cache trong bộ nhớ instance)
    const zip = await getBookZip(env, bookId);

    if (zip) {
      const toc = await decodeTocJson(record.chapters_json, env, bookId);
      const targetCh = toc.find(c => c.index === chapterIdx);
      title = targetCh?.title || `Chương ${chapterIdx}`;

      content_html = await extractChapterContent(zip, toc, chapterIdx, targetCh);
      content_html = stripDuplicateHeading(content_html, title);

      // Cache in chapters table so subsequent reads are instant (< 2ms)
      if (content_html) {
        // waitUntil: nếu không, Worker có thể bị cắt ngay khi trả phản hồi và bản cache không được ghi
        const cacheWrite = env.DB.prepare(`
          INSERT INTO chapters (book_id, chapter_index, title, content)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (book_id, chapter_index)
          DO UPDATE SET content = excluded.content, title = excluded.title
        `).bind(bookId, chapterIdx, title, content_html).run().catch(e => console.error('Chapter cache error:', e));
        if (ctx?.waitUntil) ctx.waitUntil(cacheWrite);
      }
    }
  }
  return { title, content_html };
}

async function cultivationState(env, userId) {
  const row = await env.DB.prepare('SELECT tu_vi, enabled FROM cultivation WHERE user_id = ?').bind(userId).first();
  const tuVi = row ? row.tu_vi : 0;
  return { tu_vi: tuVi, enabled: row ? !!row.enabled : true, realm: realmFor(tuVi) };
}

async function ownsBook(env, bookId, userId) {
  if (!userId) return false;
  const row = await env.DB.prepare('SELECT 1 AS ok FROM books WHERE id = ? AND user_id = ?')
    .bind(bookId, userId)
    .first();
  return !!row;
}

const MAX_TOKEN_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Cookie phiên: HttpOnly (JavaScript không đọc được), Secure, SameSite=Strict.
// Tiền tố __Host- buộc cookie chỉ thuộc đúng host này (không Domain, Path=/).
const SESSION_COOKIE = '__Host-session';
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_S}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function readSessionCookie(request) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return '';
}

// Giới hạn đăng nhập lưu trong D1 (chia sẻ giữa mọi instance Worker, không mất khi Worker khởi động lại).
// Khóa theo (tài khoản + IP) để kẻ tấn công không khóa được tài khoản của người khác từ IP khác,
// và theo riêng IP để chặn dò nhiều tài khoản.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_PER_USER_IP = 5;
const LOGIN_MAX_PER_IP = 30;

function loginKeys(request, username) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  return { userKey: `ui:${username}|${ip}`, ipKey: `ip:${ip}` };
}

async function isLoginBlocked(env, keys) {
  const now = Date.now();
  const { results } = await env.DB.prepare(
    'SELECT key, count FROM login_attempts WHERE key IN (?, ?) AND reset_at > ?'
  ).bind(keys.userKey, keys.ipKey, now).all();
  for (const r of results || []) {
    if (r.key === keys.userKey && r.count >= LOGIN_MAX_PER_USER_IP) return true;
    if (r.key === keys.ipKey && r.count >= LOGIN_MAX_PER_IP) return true;
  }
  return false;
}

async function recordLoginFailure(env, keys) {
  const now = Date.now();
  const resetAt = now + LOGIN_WINDOW_MS;
  const stmt = env.DB.prepare(`
    INSERT INTO login_attempts (key, count, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN login_attempts.reset_at <= ? THEN 1 ELSE login_attempts.count + 1 END,
      reset_at = CASE WHEN login_attempts.reset_at <= ? THEN excluded.reset_at ELSE login_attempts.reset_at END
  `);
  await env.DB.batch([
    stmt.bind(keys.userKey, resetAt, now, now),
    stmt.bind(keys.ipKey, resetAt, now, now),
    env.DB.prepare('DELETE FROM login_attempts WHERE reset_at <= ?').bind(now),
  ]);
}

async function clearLoginFailure(env, keys) {
  await env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(keys.userKey).run();
}

// Token: base64( userId : encodeURIComponent(username) : issuedAt : tokenVersion : hmac )
// tokenVersion khớp users.token_version -> tăng giá trị này sẽ vô hiệu mọi token đã cấp.
async function generateToken(userId, username, secret, tokenVersion = 0) {
  const payload = `${userId}:${encodeURIComponent(username)}:${Date.now()}:${tokenVersion}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
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

async function verifyToken(token, secret) {
  try {
    if (!secret) return null;
    const raw = atob(token);
    const parts = raw.split(':');
    if (parts.length !== 5) return null;
    const [userId, encUsername, ts, tv, sigHex] = parts;
    const timestamp = parseInt(ts, 10);
    const tokenVersion = parseInt(tv, 10);
    if (!Number.isFinite(timestamp) || !Number.isFinite(tokenVersion)) return null;

    // Check token expiration (30 days) and prevent future timestamps
    const now = Date.now();
    if (now - timestamp > MAX_TOKEN_AGE_MS || timestamp > now + 60000) {
      return null;
    }

    const payload = `${userId}:${encUsername}:${ts}:${tv}`;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = new Uint8Array(sigHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
    if (!valid) return null;

    return { userId, username: decodeURIComponent(encUsername), tokenVersion };
  } catch (e) {
    return null;
  }
}

// -----------------------------------------------------------------------------
// MAIN WORKER HANDLER
// -----------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const response = await handleRequest(request, env, ctx);
    return finalizeResponse(request, response);
  }
};

async function handleRequest(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
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
      // Chống CSRF: yêu cầu ghi dữ liệu bắt buộc có header Origin trùng origin của site
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('Origin') !== url.origin) {
        return errorResponse('Yêu cầu không hợp lệ', 403);
      }
      if (!getJwtSecret(env)) {
        console.error('JWT_SECRET chưa được cấu hình (cần >= 32 ký tự)');
        return errorResponse('Máy chủ chưa được cấu hình đúng', 500);
      }
      await initTables(env.DB);
    // 1. Auth: Register
    if (path === '/api/auth/register' && request.method === 'POST') {
      if (env.ALLOW_REGISTRATION !== 'true') {
        return errorResponse('Hệ thống tạm thời đóng đăng ký tài khoản mới.', 403);
      }
      const { username, password } = await request.json();
      if (typeof username !== 'string' || typeof password !== 'string' || username.length < 3 || password.length < 12) {
        return errorResponse('Tài khoản ít nhất 3 ký tự, mật khẩu ít nhất 12 ký tự');
      }
      if (password.length > 200) return errorResponse('Mật khẩu quá dài');
      if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username.trim())) {
        return errorResponse('Tên tài khoản chỉ gồm chữ, số, dấu gạch dưới, chấm hoặc gạch ngang (3-32 ký tự)');
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

      const jwtSecret = getJwtSecret(env);
      const token = await generateToken(userId, username.trim(), jwtSecret, 0);
      return jsonResponse(
        { user: { id: userId, username: username.trim() } },
        200,
        { 'Set-Cookie': sessionCookie(token) }
      );
    }

    // 2. Auth: Login
    if (path === '/api/auth/login' && request.method === 'POST') {
      const { username, password } = await request.json();
      if (typeof username !== 'string' || typeof password !== 'string' || password.length > 200) {
        return errorResponse('Tài khoản hoặc mật khẩu không chính xác');
      }
      const cleanUser = username.toLowerCase().trim();
      if (!cleanUser) return errorResponse('Tài khoản hoặc mật khẩu không chính xác');

      const keys = loginKeys(request, cleanUser);
      if (await isLoginBlocked(env, keys)) {
        return errorResponse('Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.', 429);
      }

      const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?')
        .bind(cleanUser)
        .first();

      // Luôn tốn thời gian băm như nhau dù tài khoản có tồn tại hay không (chống dò tài khoản qua thời gian phản hồi)
      const verify = user
        ? await verifyPassword(password, 'salt_' + user.id, user.password_hash)
        : (await pbkdf2Hex(password, 'salt_unknown', PBKDF2_ITERATIONS), { ok: false });

      if (!user || !verify.ok) {
        await recordLoginFailure(env, keys);
        return errorResponse('Tài khoản hoặc mật khẩu không chính xác');
      }

      if (verify.needsUpgrade) {
        const upgraded = await hashPassword(password, 'salt_' + user.id);
        await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(upgraded, user.id).run();
      }

      await clearLoginFailure(env, keys);
      const jwtSecret = getJwtSecret(env);
      const token = await generateToken(user.id, user.username, jwtSecret, user.token_version || 0);
      return jsonResponse(
        { user: { id: user.id, username: user.username } },
        200,
        { 'Set-Cookie': sessionCookie(token) }
      );
    }

    // Auth: Đăng xuất thiết bị này (chỉ xóa cookie; thiết bị khác vẫn đăng nhập)
    if (path === '/api/auth/logout' && request.method === 'POST') {
      return jsonResponse({ success: true }, 200, { 'Set-Cookie': clearSessionCookie() });
    }

    // Auth Middleware for all protected /api/ routes
    // Chỉ nhận phiên qua cookie HttpOnly (không qua URL hay header, để JavaScript và log không chạm vào token)
    const token = readSessionCookie(request);
    const jwtSecret = getJwtSecret(env);
    let userSession = token ? await verifyToken(token, jwtSecret) : null;
    if (userSession) {
      // Token còn hạn và chữ ký đúng vẫn phải khớp phiên bản hiện tại của tài khoản (và tài khoản còn tồn tại)
      const row = await env.DB.prepare('SELECT token_version FROM users WHERE id = ?')
        .bind(userSession.userId)
        .first();
      if (!row || (row.token_version || 0) !== userSession.tokenVersion) userSession = null;
    }

    // Auth: Check me
    if (path === '/api/auth/me' && request.method === 'GET') {
      // Chưa đăng nhập: 200 với user = null (không sinh lỗi 401 trong console mỗi lần mở trang)
      if (!userSession) return jsonResponse({ user: null });
      return jsonResponse({ user: { userId: userSession.userId, username: userSession.username } });
    }

    // Auth: Đăng xuất mọi thiết bị (vô hiệu toàn bộ token đã cấp cho tài khoản)
    if (path === '/api/auth/logout-all' && request.method === 'POST') {
      if (!userSession) return errorResponse('Phiên đăng nhập hết hạn', 401);
      await env.DB.prepare('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?')
        .bind(userSession.userId)
        .run();
      return jsonResponse({ success: true }, 200, { 'Set-Cookie': clearSessionCookie() });
    }

    if (!userSession && (path.startsWith('/api/books') || path.startsWith('/api/cultivation') || path.startsWith('/api/reading') || path.startsWith('/api/history') || path.startsWith('/api/last-read') || path.startsWith('/api/settings'))) {
      return errorResponse('Chưa đăng nhập. Vui lòng đăng nhập để sử dụng.', 401);
    }

    const userId = userSession?.userId;

    // Tu vi: trạng thái hiện tại
    if (path === '/api/cultivation' && request.method === 'GET') {
      return jsonResponse(await cultivationState(env, userId));
    }

    // Tu vi: bật/tắt hiển thị (máy chủ vẫn ghi tu vi khi tắt)
    if (path === '/api/cultivation' && request.method === 'PUT') {
      let body;
      try { body = await request.json(); } catch { return errorResponse('Dữ liệu không hợp lệ', 400); }
      if (!body || typeof body.enabled !== 'boolean') return errorResponse('Dữ liệu không hợp lệ', 400);
      await env.DB.prepare(
        `INSERT INTO cultivation (user_id, enabled) VALUES (?, ?)
         ON CONFLICT (user_id) DO UPDATE SET enabled = excluded.enabled`
      ).bind(userId, body.enabled ? 1 : 0).run();
      return jsonResponse(await cultivationState(env, userId));
    }

    // Tu vi: cộng hồi tố một lần duy nhất từ tiến độ đọc có sẵn (các chương đứng trước chương đang đọc)
    if (path === '/api/cultivation/backfill' && request.method === 'POST') {
      await env.DB.prepare('INSERT OR IGNORE INTO cultivation (user_id) VALUES (?)').bind(userId).run();
      const claim = await env.DB.prepare('UPDATE cultivation SET backfilled = 1 WHERE user_id = ? AND backfilled = 0')
        .bind(userId).run();
      if (!claim.meta || claim.meta.changes === 0) {
        return jsonResponse({ gained: 0, ...(await cultivationState(env, userId)) });
      }
      try {
        const { results: books } = await env.DB.prepare(
          'SELECT id, total_chapters, chapters_json, current_chapter FROM books WHERE user_id = ?'
        ).bind(userId).all();
        let total = 0;
        for (const b of books || []) {
          const upTo = Math.min((b.current_chapter || 1) - 1, b.total_chapters);
          for (let i = 1; i <= upTo; i++) {
            const { content_html } = await loadChapterContent(env, ctx, b, b.id, i);
            total += paragraphWordCounts(content_html).reduce((s, n) => s + n, 0);
          }
        }
        const before = (await cultivationState(env, userId)).tu_vi;
        const gained = Math.max(0, Math.min(total, MAX_TU_VI - before));
        await env.DB.prepare('UPDATE cultivation SET tu_vi = tu_vi + ? WHERE user_id = ?').bind(gained, userId).run();
        return jsonResponse({ gained, ...(await cultivationState(env, userId)) });
      } catch (e) {
        await env.DB.prepare('UPDATE cultivation SET backfilled = 0 WHERE user_id = ?').bind(userId).run();
        throw e;
      }
    }

    // Tu vi: báo đã đọc các đoạn [from_para, to_para] của một chương trong `seconds` giây.
    // Máy chủ tự đếm từ từ nội dung chương và chặn đọc nhanh hơn tốc độ cho phép.
    if (path === '/api/reading/report' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return errorResponse('Dữ liệu không hợp lệ', 400); }
      const { book_id: bookId, chapter_index: chapterIdx, from_para: fromPara, to_para: toPara, seconds } = body || {};
      if (typeof bookId !== 'string' || !Number.isInteger(chapterIdx) || !Number.isInteger(fromPara) ||
          !Number.isInteger(toPara) || typeof seconds !== 'number' || !Number.isFinite(seconds)) {
        return errorResponse('Dữ liệu không hợp lệ', 400);
      }
      const record = await env.DB.prepare('SELECT total_chapters, chapters_json FROM books WHERE id = ? AND user_id = ?')
        .bind(bookId, userId)
        .first();
      if (!record) return errorResponse('Không tìm thấy sách', 404);
      if (chapterIdx < 1 || chapterIdx > record.total_chapters) return errorResponse('Chương không hợp lệ', 400);

      const { content_html } = await loadChapterContent(env, ctx, record, bookId, chapterIdx);
      const counts = paragraphWordCounts(content_html);
      const from = Math.max(0, fromPara);
      const to = Math.min(counts.length - 1, toPara);
      let words = 0;
      for (let i = from; i <= to; i++) words += counts[i];

      const now = Date.now();
      const row = await env.DB.prepare('SELECT tu_vi, last_report_at FROM cultivation WHERE user_id = ?').bind(userId).first();
      const before = row ? row.tu_vi : 0;
      const sinceLast = row && row.last_report_at ? Math.max(0, (now - row.last_report_at) / 1000) : MAX_REPORT_SECONDS;
      const allowedSeconds = Math.max(0, Math.min(seconds, sinceLast, MAX_REPORT_SECONDS));
      const gained = Math.max(0, Math.min(words, Math.floor(allowedSeconds * MAX_WORDS_PER_SECOND), MAX_TU_VI - before));

      await env.DB.prepare(
        `INSERT INTO cultivation (user_id, tu_vi, last_report_at) VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET tu_vi = tu_vi + excluded.tu_vi, last_report_at = excluded.last_report_at`
      ).bind(userId, gained, now).run();

      const after = before + gained;
      const rBefore = realmFor(before);
      const rAfter = realmFor(after);
      return jsonResponse({
        gained,
        tu_vi: after,
        realm: rAfter,
        breakthrough: rBefore.name !== rAfter.name || rBefore.tang !== rAfter.tang,
      });
    }

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
      if (file.size > 100 * 1024 * 1024) {
        return errorResponse('File quá lớn (tối đa 100MB — giới hạn request body của Workers)', 413);
      }

      const fileBuffer = await file.arrayBuffer();
      const head = new Uint8Array(fileBuffer.slice(0, 4));
      if (head[0] !== 0x50 || head[1] !== 0x4B) {
        return errorResponse('File không phải là định dạng ZIP/EPUB hợp lệ', 400);
      }

      const bookId = 'b_' + crypto.randomUUID();

      // Check if client provided pre-parsed metadata to save server CPU
      let metadata = null;
      const metaField = formData.get('metadata');
      if (metaField) {
        try {
          const parsed = typeof metaField === 'string' ? JSON.parse(metaField) : metaField;
          if (parsed && parsed.title && Array.isArray(parsed.chapters) && parsed.chapters.length > 0) {
            metadata = {
              title: parsed.title,
              author: parsed.author || 'Khuyết danh',
              coverBase64: parsed.coverBase64 || parsed.cover_data || null,
              chapters: parsed.chapters
            };
          }
        } catch (e) {
          console.warn('Metadata parsing error, falling back to server parse:', e);
        }
      }

      // Fast metadata extraction fallback on server
      if (!metadata) {
        const zip = await JSZip.loadAsync(fileBuffer);
        metadata = await parseEpubMetadataOnly(zip, file.name);
      }

      let hasCover = 0;
      if (metadata.coverBase64) {
        if (env.BUCKET) {
          const match = metadata.coverBase64.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (match) {
            const mime = match[1];
            const bin = atob(match[2]);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            await env.BUCKET.put(`covers/${bookId}`, u8, {
              httpMetadata: { contentType: mime }
            });
            hasCover = 1;
          }
        }
        if (!hasCover && metadata.coverBase64.length < 1000000) {
          await env.DB.prepare('INSERT OR REPLACE INTO covers (book_id, cover_data) VALUES (?, ?)')
            .bind(bookId, metadata.coverBase64)
            .run();
          hasCover = 1;
        }
      }

      // Encode TOC safely: compressed if > 60KB so it never exceeds D1 100KB statement limit
      const encodedToc = await encodeTocJson(metadata.chapters, env, bookId);

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
        encodedToc,
        Date.now(),
        TOC_VERSION
      ).run();

      if (env.BUCKET) {
        await env.BUCKET.put(`epubs/${bookId}.epub`, fileBuffer, {
          httpMetadata: { contentType: 'application/epub+zip' }
        });
      } else {
        // Save raw EPUB in 60KB chunks to bypass D1 SQL length limits
        const CHUNK_SIZE = 60 * 1024;
        const uint8 = new Uint8Array(fileBuffer);
        const totalChunks = Math.ceil(uint8.length / CHUNK_SIZE);
        const chunkStatements = [];

        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(uint8.length, start + CHUNK_SIZE);
          const slice = uint8.subarray(start, end);
          const b64 = toBase64Fast(slice);

          chunkStatements.push(
            env.DB.prepare('INSERT INTO book_chunks (book_id, chunk_index, data) VALUES (?, ?, ?)')
              .bind(bookId, i, b64)
          );
        }

        // Batch in groups of 8 statements (~480KB) to respect D1 payload limits (<1MB)
        const BATCH_SIZE = 8;
        for (let i = 0; i < chunkStatements.length; i += BATCH_SIZE) {
          await env.DB.batch(chunkStatements.slice(i, i + BATCH_SIZE));
        }
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
      if (!(await ownsBook(env, bookId, userId))) return errorResponse('Không tìm thấy sách', 404);
      if (env.BUCKET) {
        const r2File = await env.BUCKET.get(`epubs/${bookId}.epub`);
        if (r2File) {
          return new Response(r2File.body, {
            headers: {
              'Content-Type': 'application/epub+zip',
              'Content-Disposition': `attachment; filename="${bookId}.epub"`,
              'Cache-Control': 'private, max-age=86400'
            }
          });
        }
      }

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
          'Content-Type': 'application/epub+zip',
          'Content-Disposition': `attachment; filename="${bookId}.epub"`,
          'Cache-Control': 'private, max-age=86400'
        }
      });
    }

    // 4.2 Chương đã tách của một sách (để trình duyệt biết còn thiếu chương nào mà Tách bù)
    const matchExtracted = path.match(/^\/api\/books\/([^\/]+)\/extracted$/);
    if (matchExtracted && request.method === 'GET') {
      const bookId = matchExtracted[1];
      const book = await env.DB.prepare('SELECT total_chapters FROM books WHERE id = ? AND user_id = ?')
        .bind(bookId, userId)
        .first();
      if (!book) return errorResponse('Không tìm thấy sách', 404);
      const { results } = await env.DB.prepare(
        'SELECT chapter_index FROM chapters WHERE book_id = ? ORDER BY chapter_index ASC'
      ).bind(bookId).all();
      return jsonResponse({ total: book.total_chapters, extracted: (results || []).map(r => r.chapter_index) });
    }

    // 4.3 Nhận một lô chương đã được trình duyệt cắt sẵn từ EPUB (Tách chương / Tách bù).
    // Máy chủ vẫn tự lọc HTML và KHÔNG ghi đè chương đã có (kể cả chương người đọc đã tự sửa).
    const matchBatch = path.match(/^\/api\/books\/([^\/]+)\/chapters\/batch$/);
    if (matchBatch && request.method === 'POST') {
      const bookId = matchBatch[1];
      const book = await env.DB.prepare('SELECT total_chapters, chapters_json FROM books WHERE id = ? AND user_id = ?')
        .bind(bookId, userId)
        .first();
      if (!book) return errorResponse('Không tìm thấy sách', 404);

      const body = await request.json();
      if (!body || !Array.isArray(body.chapters)) return errorResponse('Dữ liệu không hợp lệ', 400);
      if (body.chapters.length > MAX_BATCH_CHAPTERS) return errorResponse('Gửi quá nhiều chương một lần', 413);

      const toc = await decodeTocJson(book.chapters_json, env, bookId);
      const titles = new Map(toc.map(c => [c.index, c.title]));
      const statements = [];
      for (const item of body.chapters) {
        const index = item?.index;
        if (!Number.isInteger(index) || index < 1 || index > book.total_chapters) continue;
        if (typeof item.raw_html !== 'string') continue;
        if (item.raw_html.length > MAX_CHAPTER_RAW_CHARS) return errorResponse('Một chương quá lớn', 413);
        const title = titles.get(index) || `Chương ${index}`;
        const html = stripDuplicateHeading(cleanXhtml(item.raw_html), title);
        if (!html) continue;
        statements.push(
          env.DB.prepare(
            'INSERT INTO chapters (book_id, chapter_index, title, content) VALUES (?, ?, ?, ?) ON CONFLICT (book_id, chapter_index) DO NOTHING'
          ).bind(bookId, index, title, html)
        );
      }
      if (statements.length > 0) await env.DB.batch(statements);
      return jsonResponse({ stored: statements.length });
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

      const chapters = await decodeTocJson(record.chapters_json, env, bookId);
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

      const { title, content_html } = await loadChapterContent(env, ctx, record, bookId, chapterIdx);

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

    // 6.1 Books: Update Chapter Content (Sửa văn bản chương)
    if (matchChapter && (request.method === 'PUT' || request.method === 'POST')) {
      const bookId = matchChapter[1];
      const chapterIdx = parseInt(matchChapter[2]);
      const body = await request.json();
      if (typeof body?.content_html !== 'string' || body.content_html.length > 2_000_000) {
        return errorResponse('Thiếu nội dung chương hoặc nội dung quá lớn', 400);
      }
      // Lọc lại HTML phía server: chỉ giữ đoạn <p> và thẻ định dạng an toàn (chống XSS lưu trữ)
      const content_html = cleanXhtml(body.content_html);
      const title = String(body?.title || `Chương ${chapterIdx}`).slice(0, 300);

      if (!content_html) return errorResponse('Thiếu nội dung chương', 400);

      const book = await env.DB.prepare('SELECT id FROM books WHERE id = ? AND user_id = ?')
        .bind(bookId, userId).first();
      if (!book) return errorResponse('Không tìm thấy sách', 404);

      await env.DB.prepare(`
        INSERT INTO chapters (book_id, chapter_index, title, content)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (book_id, chapter_index)
        DO UPDATE SET content = excluded.content, title = excluded.title
      `).bind(bookId, chapterIdx, title, content_html).run();

      return jsonResponse({ success: true, book_id: bookId, chapter_index: chapterIdx, title });
    }
    // 7. Books: Update Progress
    const matchProgress = path.match(/^\/api\/books\/([^\/]+)\/progress$/);
    if (matchProgress && request.method === 'POST') {
      const bookId = matchProgress[1];
      if (!(await ownsBook(env, bookId, userId))) return errorResponse('Không tìm thấy sách', 404);
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
      if (!(await ownsBook(env, bookId, userId))) return errorResponse('Không tìm thấy sách', 404);

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
    // 10. Settings: Get & Update Reader Settings
    if (path === '/api/settings') {
      if (request.method === 'GET') {
        const row = await env.DB.prepare(
          'SELECT settings_json FROM user_settings WHERE user_id = ?'
        ).bind(userId).first();
        let settings = null;
        if (row && row.settings_json) {
          try {
            settings = JSON.parse(row.settings_json);
          } catch (e) {}
        }
        return jsonResponse({ settings });
      }

      if (request.method === 'POST') {
        const body = await request.json();
        const settings = body?.settings;
        if (!settings || typeof settings !== 'object') {
          return errorResponse('Cài đặt không hợp lệ');
        }
        await env.DB.prepare(`
          INSERT INTO user_settings (user_id, settings_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at
        `).bind(userId, JSON.stringify(settings), Date.now()).run();

        return jsonResponse({ success: true });
      }
    }

    // 9. Cover Image Stream from D1
    const matchCover = path.match(/^\/api\/books\/([^\/]+)\/cover$/);
    if (matchCover && request.method === 'GET') {
      const bookId = matchCover[1];
      const book = await env.DB.prepare('SELECT user_id FROM books WHERE id = ?').bind(bookId).first();
      if (!book) return new Response('Cover not found', { status: 404 });
      if (book.user_id !== userId) {
        return errorResponse('Không có quyền truy cập ảnh bìa này', 403);
      }

      if (env.BUCKET) {
        const r2Cover = await env.BUCKET.get(`covers/${bookId}`);
        if (r2Cover) {
          const headers = new Headers();
          headers.set('Content-Type', r2Cover.httpMetadata?.contentType || 'image/jpeg');
          headers.set('Cache-Control', 'private, max-age=86400');
          headers.set('Referrer-Policy', 'no-referrer');
          return new Response(r2Cover.body, { headers });
        }
      }

      const row = await env.DB.prepare('SELECT cover_data FROM covers WHERE book_id = ?').bind(bookId).first();
      if (!row || !row.cover_data) return new Response('Cover not found', { status: 404 });

      // cover_data is data:image/...;base64,...
      const match = row.cover_data.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match) {
        const mime = match[1];
        const binary = atob(match[2]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const headers = new Headers();
        headers.set('Content-Type', mime);
        headers.set('Cache-Control', 'private, max-age=86400');
        headers.set('Referrer-Policy', 'no-referrer');
        return new Response(bytes, { headers });
      }

      return new Response('Invalid cover data', { status: 500 });
    }

    // 10. Delete Book
    if (matchDetail && request.method === 'DELETE') {
      const bookId = matchDetail[1];
      if (!(await ownsBook(env, bookId, userId))) return errorResponse('Không tìm thấy sách', 404);
      if (env.BUCKET) {
        await env.BUCKET.delete([`epubs/${bookId}.epub`, `covers/${bookId}`, `tocs/${bookId}.json`]);
      }
      await env.DB.batch([
        env.DB.prepare('DELETE FROM books WHERE id = ? AND user_id = ?').bind(bookId, userId),
        env.DB.prepare('DELETE FROM chapters WHERE book_id = ?').bind(bookId),
        env.DB.prepare('DELETE FROM book_chunks WHERE book_id = ?').bind(bookId),
        env.DB.prepare('DELETE FROM book_tocs WHERE book_id = ?').bind(bookId),
        env.DB.prepare('DELETE FROM covers WHERE book_id = ?').bind(bookId),
        env.DB.prepare('DELETE FROM bookmarks WHERE book_id = ? AND user_id = ?').bind(bookId, userId),
        env.DB.prepare('DELETE FROM progress WHERE book_id = ? AND user_id = ?').bind(bookId, userId),
      ]);
      return jsonResponse({ success: true });
    }

      return new Response('Not Found', { status: 404, headers: {} });
    } catch (err) {
      console.error('API Error:', err);
      // Không trả chi tiết lỗi nội bộ (D1, stack...) ra ngoài
      return errorResponse('Lỗi xử lý máy chủ', 500);
    }
}

// -----------------------------------------------------------------------------
// EPUB ZIP CACHE (trong bộ nhớ instance Worker)
// Đọc liên tiếp nhiều chương của cùng một sách không phải ghép lại + giải nén cả file mỗi lần.
// -----------------------------------------------------------------------------

const ZIP_CACHE_TTL_MS = 5 * 60 * 1000;
const ZIP_CACHE_MAX_ENTRIES = 3;
// Worker có 128MB RAM: giữ tổng zip đã nạp ≤ 96MB, phần còn lại cho JSZip + response.
// Sách lớn hơn ngưỡng này vẫn đọc được, chỉ là mỗi lượt phải nạp lại từ R2/D1.
const ZIP_CACHE_MAX_BYTES = 96 * 1024 * 1024;
const zipCache = new Map(); // bookId -> { zip, at, bytes }

function base64ToBytes(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function getBookZip(env, bookId) {
  const now = Date.now();
  const hit = zipCache.get(bookId);
  if (hit && now - hit.at < ZIP_CACHE_TTL_MS) {
    hit.at = now;
    return hit.zip;
  }
  zipCache.delete(bookId);

  let bytes = null;
  if (env.BUCKET) {
    const r2Obj = await env.BUCKET.get(`epubs/${bookId}.epub`);
    if (r2Obj) bytes = new Uint8Array(await r2Obj.arrayBuffer());
  }
  if (!bytes) {
    // Đọc theo trang thay vì .all() một lượt: sách 40MB có ~700 chunk, nạp hết cùng lúc
    // nghĩa là giữ ~58MB base64 + 42MB buffer trong RAM (Worker chỉ có 128MB).
    const PAGE = 24; // ~1.9MB base64 mỗi lượt
    const buffers = [];
    let total = 0;
    for (let start = 0; ; start += PAGE) {
      const { results: chunkRows } = await env.DB.prepare(
        'SELECT data FROM book_chunks WHERE book_id = ? ORDER BY chunk_index ASC LIMIT ? OFFSET ?'
      ).bind(bookId, PAGE, start).all();
      if (!chunkRows || chunkRows.length === 0) break;
      for (const row of chunkRows) {
        const b = base64ToBytes(row.data);
        buffers.push(b);
        total += b.length;
      }
      if (chunkRows.length < PAGE) break;
    }
    if (buffers.length === 0) return null;
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const b of buffers) {
      bytes.set(b, offset);
      offset += b.length;
    }
  }

  const zip = await JSZip.loadAsync(bytes);
  if (bytes.length <= ZIP_CACHE_MAX_BYTES) {
    zipCache.set(bookId, { zip, at: now, bytes: bytes.length });
    const totalBytes = () => [...zipCache.values()].reduce((n, e) => n + e.bytes, 0);
    // Ưu tiên đuổi mục cũ nhất cho tới khi thoả cả số lượng lẫn tổng dung lượng
    while (zipCache.size > 1 && (zipCache.size > ZIP_CACHE_MAX_ENTRIES || totalBytes() > ZIP_CACHE_MAX_BYTES)) {
      const oldest = [...zipCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      zipCache.delete(oldest[0]);
    }
  }
  return zip;
}

// -----------------------------------------------------------------------------
// D1 DATABASE SCHEMA INITIALIZATION
// -----------------------------------------------------------------------------

let tablesInitialized = false;

// Thêm cột còn thiếu cho DB tạo bằng phiên bản cũ (CREATE TABLE IF NOT EXISTS không tự thêm cột)
async function ensureColumn(db, table, column, ddl) {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
  if (!(results || []).some(r => r.name === column)) {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`).run();
  }
}

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
      CREATE TABLE IF NOT EXISTS book_chunks (
        book_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (book_id, chunk_index)
      )
    `).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS book_tocs (
        book_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (book_id, chunk_index)
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
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        settings_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      )
    `).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS cultivation (
        user_id TEXT PRIMARY KEY,
        tu_vi INTEGER NOT NULL DEFAULT 0,
        last_report_at INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        backfilled INTEGER NOT NULL DEFAULT 0
      )
    `).run();

    // Đồng bộ cột với schema.sql cho DB tạo từ bản cũ
    await ensureColumn(db, 'users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(db, 'books', 'para_index', 'INTEGER DEFAULT 0');
    await ensureColumn(db, 'books', 'toc_version', 'INTEGER DEFAULT 0');
    await ensureColumn(db, 'books', 'focus_para', 'INTEGER DEFAULT -1');
    await ensureColumn(db, 'books', 'focus_chapter', 'INTEGER DEFAULT -1');
    await ensureColumn(db, 'progress', 'para_index', 'INTEGER DEFAULT 0');
    await ensureColumn(db, 'progress', 'focus_para', 'INTEGER DEFAULT -1');
    await ensureColumn(db, 'progress', 'focus_chapter', 'INTEGER DEFAULT -1');

    await db.prepare('CREATE INDEX IF NOT EXISTS idx_books_user_added ON books (user_id, added_at DESC)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_progress_user_updated ON progress (user_id, updated_at DESC)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_login_attempts_reset ON login_attempts (reset_at)').run();
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

// Giới hạn lô chương trình duyệt gửi lên (Tách chương / Tách bù)
const MAX_BATCH_CHAPTERS = 40;
const MAX_CHAPTER_RAW_CHARS = 500_000;

function toBase64Fast(u8) {
  let binary = '';
  const len = u8.byteLength;
  const CHUNK = 8192;
  for (let i = 0; i < len; i += CHUNK) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, Math.min(len, i + CHUNK)));
  }
  return btoa(binary);
}

async function encodeTocJson(chapters, env, bookId) {
  const json = JSON.stringify((chapters || []).map(c => ({ index: c.index, title: c.title, href: c.href })));

  // If R2 is enabled, store full uncompressed TOC JSON in R2
  if (env && env.BUCKET && bookId) {
    try {
      await env.BUCKET.put(`tocs/${bookId}.json`, json, {
        httpMetadata: { contentType: 'application/json' }
      });
    } catch (e) {
      console.error('Failed to put TOC to R2:', e);
    }
  }

  // Under 60KB: store raw JSON directly in D1
  if (json.length <= 60000) return json;

  // Deflate-compress to fit within Cloudflare D1 100KB statement limit
  try {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(new TextEncoder().encode(json));
    writer.close();
    const reader = cs.readable.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const u8 = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      u8.set(c, off);
      off += c.length;
    }
    const b64 = 'gz:' + toBase64Fast(u8);

    // Fits in D1 single statement
    if (b64.length <= 85000) return b64;

    // Fallback for massive books (5,000+ chapters): split into book_tocs table
    if (env && env.DB && bookId) {
      const TOC_CHUNK = 60000;
      const totalTocs = Math.ceil(b64.length / TOC_CHUNK);
      for (let i = 0; i < totalTocs; i++) {
        const slice = b64.slice(i * TOC_CHUNK, (i + 1) * TOC_CHUNK);
        await env.DB.prepare('INSERT OR REPLACE INTO book_tocs (book_id, chunk_index, data) VALUES (?, ?, ?)')
          .bind(bookId, i, slice)
          .run();
      }
      return 'table:book_tocs';
    }
    return b64;
  } catch (e) {
    console.error('encodeTocJson compression failed:', e);
    return json.slice(0, 50000);
  }
}

async function decodeTocJson(str, env, bookId) {
  // If R2 has the TOC, load directly from R2
  if (env && env.BUCKET && bookId) {
    try {
      const r2Toc = await env.BUCKET.get(`tocs/${bookId}.json`);
      if (r2Toc) {
        return await r2Toc.json();
      }
    } catch (e) {}
  }

  if (!str) return [];

  // Check if chunked in book_tocs table
  if (str === 'table:book_tocs' && env && env.DB && bookId) {
    try {
      const { results } = await env.DB.prepare(
        'SELECT data FROM book_tocs WHERE book_id = ? ORDER BY chunk_index ASC'
      ).bind(bookId).all();
      if (results && results.length > 0) {
        str = results.map(r => r.data).join('');
      }
    } catch (e) {
      console.error('Failed to read book_tocs:', e);
    }
  }

  if (!str.startsWith('gz:')) {
    try {
      return JSON.parse(str);
    } catch (e) {
      return [];
    }
  }

  try {
    const rawB64 = str.slice(3);
    const bin = atob(rawB64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);

    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(u8);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const resU8 = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      resU8.set(c, off);
      off += c.length;
    }
    return JSON.parse(new TextDecoder().decode(resU8));
  } catch (e) {
    console.error('decodeTocJson decompression failed:', e);
    return [];
  }
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

    const encodedToc = await encodeTocJson(metadata.chapters, env, record.id);
    await env.DB.prepare(
      'UPDATE books SET chapters_json = ?, total_chapters = ?, toc_version = ? WHERE id = ?'
    ).bind(
      encodedToc,
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
  const raw = await extractChapterRaw(zip, toc, chapterIdx, targetCh, findZipFile);
  return raw ? cleanXhtml(raw) : '';
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
    const rawSrc = srcMatch ? srcMatch[1].trim() : null;
    entries.push({ title, src: rawSrc ? safeDecodeURI(rawSrc) : null });
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

function getZipNormalizedMap(zip) {
  if (zip._normMap) return zip._normMap;
  const map = new Map();
  for (const name of Object.keys(zip.files)) {
    map.set(name.toLowerCase().replace(/\\/g, '/'), zip.files[name]);
  }
  zip._normMap = map;
  return map;
}

function findZipFile(zip, filename) {
  if (!filename) return null;
  const decoded = safeDecodeURI(filename);
  if (zip.files[decoded]) return zip.files[decoded];
  if (zip.files[filename]) return zip.files[filename];

  const targetDecoded = decoded.toLowerCase().replace(/\\/g, '/');
  const targetRaw = filename.toLowerCase().replace(/\\/g, '/');
  const map = getZipNormalizedMap(zip);
  if (map.has(targetDecoded)) return map.get(targetDecoded);
  if (map.has(targetRaw)) return map.get(targetRaw);

  for (const [key, file] of map.entries()) {
    if (key.endsWith(targetDecoded) || key.endsWith(targetRaw)) return file;
  }

  const baseName = targetDecoded.split('/').pop();
  if (baseName) {
    for (const [key, file] of map.entries()) {
      if (key.split('/').pop() === baseName) return file;
    }
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
    if (manifest['cover-image']) coverHref = manifest['cover-image'];
    else if (manifest['cover']) coverHref = manifest['cover'];
  }
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
      const ext = coverHref.toLowerCase().endsWith('.png') ? 'png' : (coverHref.toLowerCase().endsWith('.webp') ? 'webp' : 'jpeg');
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
  let bodyContent = raw || '';
  const bodyM = bodyContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyM) bodyContent = bodyM[1];

  // Strip dangerous tag blocks
  bodyContent = bodyContent
    .replace(/<(script|style|iframe|object|embed|svg|math|form|base|meta|link|applet)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|svg|math|form|base|meta|link|applet)\b[^>]*>/gi, '')
    .replace(/<span\b[^>]*><\/span>/gi, '');

  const plain = (s) => (s || '')
    // Remove inline event handlers
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gis, '')
    .replace(/\son\w+\s*=\s*[^ >]+/gis, '')
    // Remove dangerous protocols
    .replace(/(href|src)\s*=\s*(['"])\s*(javascript|vbscript|data):.*?\2/gis, '')
    // Strip all tags EXCEPT safe formatting: em, strong, b, i, u, br
    .replace(/<(?!\/?(i|em|b|strong|u|br)\b)[^>]*>/gi, '')
    // Strip any attributes left on the remaining safe formatting tags
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
