export const DEFAULT_WORKER_URL = 'https://cuu-u-reader.toihoccode1405.workers.dev';

// Worker phục vụ cả giao diện lẫn API nên mặc định gọi cùng origin (cũng hợp với CSP connect-src 'self').
// Chỉ khi chạy `vite dev` (cổng riêng, không có Worker) mới gọi sang Worker đã deploy.
export function getApiBase() {
  return import.meta.env.DEV ? DEFAULT_WORKER_URL : '';
}

export function getApiUrl(path) {
  const base = getApiBase();
  return `${base}${path}`;
}

export async function apiFetch(path, options = {}) {
  const url = getApiUrl(path);
  let resp;
  try {
    resp = await fetch(url, options);
  } catch (err) {
    throw new Error('Không thể kết nối đến máy chủ. Vui lòng kiểm tra lại kết nối mạng.');
  }

  const contentType = resp.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!resp.ok) {
      throw new Error(`Máy chủ phản hồi lỗi (${resp.status}). Vui lòng thử lại sau.`);
    }
    throw new Error('Phản hồi từ máy chủ không hợp lệ.');
  }

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error || `Lỗi máy chủ (${resp.status})`);
  }
  return data;
}
