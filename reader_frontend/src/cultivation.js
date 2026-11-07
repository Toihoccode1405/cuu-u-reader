// Tu vi phía trình duyệt: gọi API và giữ hàng đợi báo cáo khi mất mạng.
// Máy chủ mới là nơi tính tu vi; ở đây chỉ báo "đã đọc đoạn nào trong bao lâu".
import { getApiUrl } from './api.js';

const QUEUE_KEY = 'cuu-report-queue';
const MAX_QUEUE = 200;

function readQueue() {
  try {
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

function writeQueue(q) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
  } catch {
    // localStorage bị chặn: bỏ qua, chỉ mất báo cáo offline
  }
}

export function clearReportQueue() {
  try {
    localStorage.removeItem(QUEUE_KEY);
  } catch {
    // bỏ qua
  }
}

const json = (r) => r.json().catch(() => null);

export async function fetchCultivation() {
  try {
    const r = await fetch(getApiUrl('/api/cultivation'));
    return r.ok ? await json(r) : null;
  } catch {
    return null;
  }
}

// Cộng hồi tố chỉ có tác dụng một lần (lần sau máy chủ trả gained = 0), gọi lại vô hại
export async function runBackfill() {
  try {
    const r = await fetch(getApiUrl('/api/cultivation/backfill'), { method: 'POST' });
    return r.ok ? await json(r) : null;
  } catch {
    return null;
  }
}

export async function setCultivationEnabled(enabled) {
  try {
    const r = await fetch(getApiUrl('/api/cultivation'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    return r.ok ? await json(r) : null;
  } catch {
    return null;
  }
}

// Gửi một báo cáo. Trả về phản hồi của máy chủ; null nếu máy chủ từ chối (4xx, bỏ đi); ném lỗi nếu cần thử lại sau.
async function send(report) {
  const r = await fetch(getApiUrl('/api/reading/report'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
  if (r.ok) return json(r);
  if (r.status >= 500) throw new Error('server');
  return null;
}

// Gửi bù hàng đợi theo thứ tự; dừng ở báo cáo đầu tiên chưa gửi được
export async function flushReportQueue() {
  const results = [];
  let q = readQueue();
  while (q.length) {
    try {
      const res = await send(q[0]);
      if (res) results.push(res);
    } catch {
      return { results, pending: true };
    }
    q = q.slice(1);
    writeQueue(q);
  }
  return { results, pending: false };
}

// Báo cũ còn trong hàng đợi phải đi trước để đúng thứ tự thời gian
export async function submitReading(report) {
  const flushed = await flushReportQueue();
  const results = [...flushed.results];
  if (flushed.pending) {
    writeQueue([...readQueue(), report]);
    return results;
  }
  try {
    const res = await send(report);
    if (res) results.push(res);
  } catch {
    writeQueue([...readQueue(), report]);
  }
  return results;
}

export function hasQueuedReports() {
  return readQueue().length > 0;
}
