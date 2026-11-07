import { describe, it, expect } from 'vitest';
import { api } from './helpers.js';

describe('S4 - CORS và header của API', () => {
  it('không cho origin nào khác gọi API từ trình duyệt (kể cả origin chạy thử cũ)', async () => {
    for (const origin of ['https://evil.example', 'http://localhost:5173']) {
      const res = await api('/api/auth/me', { headers: { Origin: origin } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  it('preflight không cấp quyền cho bất kỳ origin nào khác', async () => {
    for (const origin of ['https://evil.example', 'http://localhost:5173']) {
      const res = await api('/api/books', { method: 'OPTIONS', headers: { Origin: origin } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  it('phản hồi JSON không bị cache và có header chống nhúng khung', async () => {
    const res = await api('/api/auth/me');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('không lộ chi tiết lỗi nội bộ khi gửi dữ liệu hỏng', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    });
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toMatch(/SyntaxError|JSON|at |stack/i);
  });
});
