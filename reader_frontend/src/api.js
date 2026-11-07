// Worker phục vụ cả giao diện lẫn API trên cùng một origin, và phiên đăng nhập là cookie HttpOnly
// chỉ gửi trong origin này. Vì vậy luôn gọi đường dẫn tương đối (không gọi sang origin khác).
// Chạy thử cục bộ: dùng `wrangler dev` với bản build, không dùng `vite dev`.
export function getApiBase() {
  return '';
}

export function getApiUrl(path) {
  return `${getApiBase()}${path}`;
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
