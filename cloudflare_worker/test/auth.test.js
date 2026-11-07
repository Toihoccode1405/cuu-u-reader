import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../src/index.js';
import { api, registerUser, uniqueName, PASSWORD, cookieFrom } from './helpers.js';

const login = (username, password, ip = '203.0.113.1') =>
  api('/api/auth/login', { method: 'POST', body: { username, password }, headers: { 'CF-Connecting-IP': ip } });

describe('S1 - Đăng ký và đăng nhập', () => {
  it('người đọc đăng ký rồi đăng nhập lại được', async () => {
    const { res, name, token } = await registerUser();
    expect(res.status).toBe(200);
    expect(token).toBeTruthy();

    const again = await login(name, PASSWORD);
    expect(again.status).toBe(200);
    expect(cookieFrom(again)).toBeTruthy();
  });

  it('tên tài khoản có chữ có dấu vẫn dùng được', async () => {
    const name = `Hoàng_${uniqueName('v')}`;
    const { res, token } = await registerUser(name);
    expect(res.status).toBe(200);
    const me = await api('/api/auth/me', { token });
    expect((await me.json()).user.username).toBe(name);
  });

  it.each([
    ['mật khẩu dưới 8 ký tự', () => ({ username: uniqueName(), password: 'ngan' })],
    ['tên tài khoản có dấu hai chấm', () => ({ username: 'a:b:c', password: PASSWORD })],
    ['tên tài khoản quá ngắn', () => ({ username: 'ab', password: PASSWORD })],
  ])('từ chối đăng ký khi %s', async (_label, make) => {
    const res = await api('/api/auth/register', { method: 'POST', body: make() });
    expect(res.status).toBe(400);
  });

  it('không cho đăng ký trùng tên', async () => {
    const { name } = await registerUser();
    const dup = await registerUser(name);
    expect(dup.res.status).toBe(400);
  });

  it('báo cùng một thông điệp khi sai mật khẩu và khi tài khoản không tồn tại', async () => {
    const { name } = await registerUser();
    const wrongPw = await login(name, 'sai-mat-khau-xyz', '203.0.113.2');
    const noUser = await login('khong_ton_tai_' + uniqueName(), 'sai-mat-khau-xyz', '203.0.113.2');
    expect(wrongPw.status).toBe(400);
    expect(noUser.status).toBe(400);
    expect(await wrongPw.json()).toEqual(await noUser.json());
  });

  it('khóa đăng nhập sau 5 lần sai, kể cả khi lần sau nhập đúng mật khẩu', async () => {
    const { name } = await registerUser();
    const ip = '198.51.100.7';
    for (let i = 0; i < 5; i++) {
      expect((await login(name, 'sai-mat-khau-xyz', ip)).status).toBe(400);
    }
    expect((await login(name, PASSWORD, ip)).status).toBe(429);
  });

  it('không khóa nhầm người đọc đăng nhập từ IP khác', async () => {
    const { name } = await registerUser();
    for (let i = 0; i < 5; i++) await login(name, 'sai-mat-khau-xyz', '198.51.100.8');
    expect((await login(name, PASSWORD, '198.51.100.9')).status).toBe(200);
  });

  it('mật khẩu băm kiểu cũ (50.000 vòng) vẫn đăng nhập được, và vẫn được sau lần nâng cấp', async () => {
    const id = 'u_legacy_' + uniqueName();
    const name = uniqueName('legacy');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(PASSWORD), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode('salt_' + id), iterations: 50000, hash: 'SHA-256' },
      key,
      256
    );
    const legacyHash = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
    // Gọi một request để Worker tạo bảng, rồi chèn người đọc kiểu cũ
    await api('/api/auth/me');
    await env.DB.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, name, legacyHash, Date.now())
      .run();

    expect((await login(name, PASSWORD, '203.0.113.20')).status).toBe(200);
    expect((await login(name, PASSWORD, '203.0.113.20')).status).toBe(200);
    expect((await login(name, 'sai-mat-khau-xyz', '203.0.113.20')).status).toBe(400);
  });
});

describe('S1 - Phiên đăng nhập', () => {
  it('/me trả về người đọc khi token hợp lệ, 401 khi token sai', async () => {
    const { token, name } = await registerUser();
    const ok = await api('/api/auth/me', { token });
    expect(ok.status).toBe(200);
    expect((await ok.json()).user.username).toBe(name);

    // Chưa đăng nhập hoặc phiên sai: vẫn trả 200 với user = null (để trang web hỏi phiên mà không sinh lỗi 401 trong console)
    for (const bad of [await api('/api/auth/me', { token: token + 'x' }), await api('/api/auth/me')]) {
      expect(bad.status).toBe(200);
      expect((await bad.json()).user).toBeNull();
    }
  });

  it('đăng xuất mọi thiết bị vô hiệu mọi token cũ nhưng đăng nhập lại vẫn được', async () => {
    const { token: t1, name } = await registerUser();
    const t2 = cookieFrom(await login(name, PASSWORD, '203.0.113.30'));

    expect((await api('/api/auth/logout-all', { method: 'POST', token: t2 })).status).toBe(200);
    expect((await api('/api/books', { token: t1 })).status).toBe(401);
    expect((await api('/api/books', { token: t2 })).status).toBe(401);

    const t3 = cookieFrom(await login(name, PASSWORD, '203.0.113.30'));
    expect((await api('/api/books', { token: t3 })).status).toBe(200);
  });

  it('đăng xuất mọi thiết bị của người này không ảnh hưởng người kia', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await api('/api/auth/logout-all', { method: 'POST', token: a.token });
    expect((await api('/api/books', { token: b.token })).status).toBe(200);
  });

  it('không nhận token đặt trên URL hay trong header Authorization', async () => {
    const { token } = await registerUser();
    expect((await api(`/api/books?token=${token}`)).status).toBe(401);
    expect((await api('/api/books', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
  });
});

describe('S1 - Cấu hình máy chủ', () => {
  it('đóng đăng ký khi ALLOW_REGISTRATION không bật', async () => {
    const req = new Request('https://example.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uniqueName(), password: PASSWORD }),
    });
    const res = await worker.fetch(req, { ...env, ALLOW_REGISTRATION: 'false' }, { waitUntil() {} });
    expect(res.status).toBe(403);
  });

  it('từ chối phục vụ khi thiếu JWT_SECRET hoặc quá ngắn', async () => {
    const req = () => new Request('https://example.com/api/books');
    expect((await worker.fetch(req(), { ...env, JWT_SECRET: undefined }, { waitUntil() {} })).status).toBe(500);
    expect((await worker.fetch(req(), { ...env, JWT_SECRET: 'ngan' }, { waitUntil() {} })).status).toBe(500);
  });
});
