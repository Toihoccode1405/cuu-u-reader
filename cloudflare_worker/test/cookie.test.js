import { describe, it, expect } from 'vitest';
import { api, registerUser, uniqueName, PASSWORD, COOKIE_NAME, cookieFrom } from './helpers.js';

const login = (username, password = PASSWORD, ip = '203.0.113.50') =>
  api('/api/auth/login', { method: 'POST', body: { username, password }, headers: { 'CF-Connecting-IP': ip } });

describe('S1 - Phiên bằng cookie HttpOnly', () => {
  it('đăng ký và đăng nhập đặt cookie phiên đúng thuộc tính, JavaScript không đọc được', async () => {
    const { res, name } = await registerUser();
    for (const r of [res, await login(name)]) {
      const setCookie = r.headers.get('set-cookie') || '';
      expect(setCookie).toContain(`${COOKIE_NAME}=`);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/Secure/i);
      expect(setCookie).toMatch(/SameSite=Strict/i);
      expect(setCookie).toMatch(/Path=\//i);
      expect(setCookie).toMatch(/Max-Age=2592000/i);
      expect(setCookie).not.toMatch(/Domain=/i); // bắt buộc với tiền tố __Host-
    }
  });

  it('thân phản hồi chỉ có thông tin người đọc, không chứa token', async () => {
    const name = uniqueName();
    const res = await api('/api/auth/register', { method: 'POST', body: { username: name, password: PASSWORD } });
    const body = await res.json();
    expect(body.user.username).toBe(name);
    expect(JSON.stringify(body)).not.toContain(cookieFrom(res));
    expect(body.token).toBeUndefined();
  });

  it('cookie giả hoặc bị sửa thì bị từ chối', async () => {
    const { token } = await registerUser();
    expect((await api('/api/books', { token: token.slice(0, -4) + 'AAAA' })).status).toBe(401);
    expect((await api('/api/books', { token: 'khong-phai-token' })).status).toBe(401);
  });

  it('đăng xuất xóa cookie ở thiết bị này nhưng không ảnh hưởng thiết bị khác', async () => {
    const { token: deviceA, name } = await registerUser();
    const deviceB = cookieFrom(await login(name));

    const out = await api('/api/auth/logout', { method: 'POST', token: deviceA });
    expect(out.status).toBe(200);
    const cleared = out.headers.get('set-cookie') || '';
    expect(cleared).toContain(`${COOKIE_NAME}=`);
    expect(cleared).toMatch(/Max-Age=0/i);

    expect((await api('/api/books', { token: deviceB })).status).toBe(200);
  });

  it('đăng xuất mọi thiết bị cũng xóa cookie ở thiết bị này', async () => {
    const { token } = await registerUser();
    const out = await api('/api/auth/logout-all', { method: 'POST', token });
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie') || '').toMatch(/Max-Age=0/i);
  });

  it('mật khẩu của tài khoản mới phải từ 12 ký tự', async () => {
    const short = await registerUser(uniqueName(), 'a'.repeat(11));
    expect(short.res.status).toBe(400);
    const ok = await registerUser(uniqueName(), 'a'.repeat(12));
    expect(ok.res.status).toBe(200);
  });
});

describe('S4 - Chống CSRF cho yêu cầu ghi dữ liệu', () => {
  it('từ chối yêu cầu ghi thiếu header Origin', async () => {
    const { token } = await registerUser();
    const res = await api('/api/settings', { method: 'POST', token, body: { settings: { a: 1 } }, origin: null });
    expect(res.status).toBe(403);
  });

  it('từ chối yêu cầu ghi đến từ origin lạ dù có cookie hợp lệ', async () => {
    const { token } = await registerUser();
    const res = await api('/api/settings', {
      method: 'POST', token, body: { settings: { a: 1 } }, origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
    // và dữ liệu không bị thay đổi
    expect((await (await api('/api/settings', { token })).json()).settings).toBeNull();
  });

  it('từ chối cả đăng nhập và đăng ký từ origin lạ (chống ép đăng nhập)', async () => {
    const { name } = await registerUser();
    const res = await api('/api/auth/login', {
      method: 'POST', body: { username: name, password: PASSWORD }, origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('yêu cầu đọc (GET) không cần header Origin', async () => {
    const { token } = await registerUser();
    expect((await api('/api/books', { token })).status).toBe(200);
  });

  it('xóa sách cũng bị chặn khi origin lạ', async () => {
    const { token } = await registerUser();
    const res = await api('/api/books/b_nao_do', { method: 'DELETE', token, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });
});
