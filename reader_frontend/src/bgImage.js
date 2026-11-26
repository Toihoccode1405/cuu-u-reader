// Ảnh nền do người dùng tự chọn: chỉ lưu trong trình duyệt của máy này (IndexedDB), không gửi lên server.
// Hai ô riêng: 'desktop' (máy tính, máy tính bảng) và 'phone' (rộng <= 640px). Giá trị lưu là Blob WebP đã thu nhỏ.
import { useEffect, useState } from 'react';

const DB = 'cuu_u_bg';
const STORE = 'img';
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIDE = { desktop: 2560, phone: 1440 };

export const PHONE_QUERY = '(max-width: 640px)';
export const slotFor = () => (window.matchMedia(PHONE_QUERY).matches ? 'phone' : 'desktop');

function openDb() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

const listeners = new Set();
const notify = () => listeners.forEach((f) => f());

export const getBgImage = (slot) => tx('readonly', (s) => s.get(slot)).then((v) => v || null);

export async function removeBgImage(slot) {
  await tx('readwrite', (s) => s.delete(slot));
  notify();
}

// Kiểm tra, thu nhỏ rồi nén WebP. Ném Error với thông báo tiếng Việt để hiện cho người dùng.
export async function saveBgImage(slot, file) {
  if (!ALLOWED.includes(file.type)) throw new Error('Chỉ nhận ảnh JPG, PNG hoặc WebP.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Ảnh quá lớn, tối đa 20 MB.');
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('Không đọc được ảnh này. Hãy thử ảnh khác.');
  }
  const k = Math.min(1, MAX_SIDE[slot] / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const toBlob = (type, q) => new Promise((res) => canvas.toBlob(res, type, q));
  let blob = await toBlob('image/webp', 0.82);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.85); // trình duyệt không nén được WebP
  if (!blob) throw new Error('Không xử lý được ảnh này.');
  try {
    await tx('readwrite', (s) => s.put(blob, slot));
  } catch {
    throw new Error('Không lưu được ảnh trên máy này (có thể đang ở chế độ ẩn danh).');
  }
  notify();
}

export function useMediaQuery(query) {
  const [m, setM] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

// Ảnh nền hiện tại của máy này: 'loading' (đang đọc, chưa nên tải ảnh mặc định), 'custom' (có blob URL) hoặc 'default'
export function useBgImage(enabled) {
  const phone = useMediaQuery(PHONE_QUERY);
  const slot = phone ? 'phone' : 'desktop';
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({ status: 'loading', url: null });

  useEffect(() => {
    const f = () => setVersion((v) => v + 1);
    listeners.add(f);
    return () => listeners.delete(f);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let url = null;
    let dead = false;
    setState((s) => (s.status === 'custom' ? s : { status: 'loading', url: null }));
    getBgImage(slot)
      .then((blob) => {
        if (dead) return;
        if (blob) {
          url = URL.createObjectURL(blob);
          setState({ status: 'custom', url });
        } else {
          setState({ status: 'default', url: null });
        }
      })
      .catch(() => { if (!dead) setState({ status: 'default', url: null }); });
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [enabled, slot, version]);

  return { ...state, slot };
}
