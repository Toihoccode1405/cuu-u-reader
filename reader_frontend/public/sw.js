// Service Worker: mở nhanh và đọc offline.
// - Vỏ ứng dụng (index.html, /assets/*): lưu khi đã tải được, mất mạng thì dùng bản đã lưu.
// - Dữ liệu đọc (sách, chương, thông tin phiên): mạng trước, mất mạng thì dùng bản đã lưu.
// - Dữ liệu cá nhân nằm trong cache riêng, xóa sạch khi đăng xuất (client gửi thông điệp 'wipe').
const SHELL_CACHE = 'cuu-shell-v1';
const DATA_CACHE = 'cuu-data-v1';

// Chỉ lưu những GET đọc dữ liệu này; mọi thứ khác (đăng nhập, ghi, tải file EPUB gốc) luôn đi qua mạng
const DATA_PATHS = [
  /^\/api\/auth\/me$/,
  /^\/api\/books$/,
  /^\/api\/books\/[^/]+$/,
  /^\/api\/books\/[^/]+\/chapters\/\d+$/,
  /^\/api\/books\/[^/]+\/cover$/,
  /^\/api\/books\/[^/]+\/bookmarks$/,
  /^\/api\/history$/,
  /^\/api\/last-read$/,
  /^\/api\/settings$/,
];

self.addEventListener('install', (event) => {
  // Trang chính có sẵn trong cache ngay từ lần cài đầu để mất mạng vẫn mở được
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.add(new Request('/', { cache: 'reload' })))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== SHELL_CACHE && name !== DATA_CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'wipe') {
    event.waitUntil(caches.delete(DATA_CACHE));
  }
  // Trang gửi danh sách tài nguyên tĩnh nó đã tải trước khi Service Worker kiểm soát trang
  if (event.data && event.data.type === 'cache-shell' && Array.isArray(event.data.urls)) {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        for (const u of event.data.urls.slice(0, 200)) {
          const url = new URL(u, self.location.origin);
          if (url.origin !== self.location.origin) continue;
          if (!/^\/(assets\/|favicon\.svg$|icons\.svg$)/.test(url.pathname)) continue;
          if (!(await cache.match(url.pathname))) await cache.add(url.pathname).catch(() => {});
        }
      })()
    );
  }
});

async function networkFirst(request, cacheName, shouldStore) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok && (!shouldStore || (await shouldStore(res.clone())))) {
      await cache.put(request, res.clone());
    }
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    throw err;
  }
}

// Chưa đăng nhập (user: null) thì không lưu, để mất mạng không "đăng nhập giả"
async function hasUser(res) {
  try {
    const data = await res.json();
    return !!(data && data.user);
  } catch {
    return false;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    if (!DATA_PATHS.some((re) => re.test(url.pathname))) return;
    const isMe = url.pathname === '/api/auth/me';
    event.respondWith(networkFirst(req, DATA_CACHE, isMe ? hasUser : null));
    return;
  }

  if (req.mode === 'navigate') {
    // Mọi đường dẫn trang đều là cùng một ứng dụng một trang
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const res = await fetch(req);
          if (res.ok) await cache.put('/', res.clone());
          return res;
        } catch (err) {
          const hit = await cache.match('/');
          if (hit) return hit;
          throw err;
        }
      })()
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.svg' || url.pathname === '/icons.svg') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit; // tên file có mã băm, không bao giờ đổi nội dung
        const res = await fetch(req);
        if (res.ok) await cache.put(req, res.clone());
        return res;
      })()
    );
  }
});
