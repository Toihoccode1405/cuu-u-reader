import { describe, it, expect } from 'vitest';
import { api } from './helpers.js';

describe('S4 - CORS và header của API', () => {
  it('không cho origin lạ gọi API từ trình duyệt', async () => {
    const res = await api('/api/auth/me', { headers: { Origin: 'https://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('cho phép chính origin của site và origin chạy thử cục bộ', async () => {
    const self = await api('/api/auth/me', { headers: { Origin: 'https://example.com' } });
    expect(self.headers.get('access-control-allow-origin')).toBe('https://example.com');
    const dev = await api('/api/auth/me', { headers: { Origin: 'http://localhost:5173' } });
    expect(dev.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('trả lời preflight cho origin được phép, không cấp quyền cho origin lạ', async () => {
    const ok = await api('/api/books', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(ok.headers.get('access-control-allow-headers')).toContain('Authorization');

    const bad = await api('/api/books', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
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
