import { describe, it, expect, beforeEach } from 'vitest';
import { api, registerUser, buildEpub, uploadBook } from './helpers.js';

// S2 - Quyền sở hữu: người B không được đọc, sửa, xóa sách của người A ở bất kỳ endpoint nào
describe('S2 - Quyền sở hữu sách', () => {
  let a, b, bookId;

  beforeEach(async () => {
    a = await registerUser();
    b = await registerUser();
    const { book } = await uploadBook(a.token, await buildEpub({ title: 'Sach cua A' }));
    bookId = book.id;
  });

  const attacks = [
    ['xem chi tiết sách', (id, t) => api(`/api/books/${id}`, { token: t })],
    ['đọc chương', (id, t) => api(`/api/books/${id}/chapters/1`, { token: t })],
    ['sửa chương', (id, t) => api(`/api/books/${id}/chapters/1`, { method: 'PUT', token: t, body: { content_html: '<p>pha</p>' } })],
    ['tải file EPUB', (id, t) => api(`/api/books/${id}/file`, { token: t })],
    ['xem ảnh bìa', (id, t) => api(`/api/books/${id}/cover`, { token: t })],
    ['xóa sách', (id, t) => api(`/api/books/${id}`, { method: 'DELETE', token: t })],
    ['ghi tiến độ đọc', (id, t) => api(`/api/books/${id}/progress`, { method: 'POST', token: t, body: { chapter_index: 2, scroll_percent: 50 } })],
    ['xem dấu trang', (id, t) => api(`/api/books/${id}/bookmarks`, { token: t })],
    ['thêm dấu trang', (id, t) => api(`/api/books/${id}/bookmarks`, { method: 'POST', token: t, body: { chapter_index: 1, para_index: 0 } })],
    ['xóa dấu trang', (id, t) => api(`/api/books/${id}/bookmarks`, { method: 'DELETE', token: t, body: {} })],
  ];

  it.each(attacks)('người khác không thể %s', async (_label, attack) => {
    const res = await attack(bookId, b.token);
    expect([403, 404]).toContain(res.status);
  });

  it('sau mọi lần tấn công, sách của A vẫn nguyên vẹn', async () => {
    for (const [, attack] of attacks) await attack(bookId, b.token);

    const detail = await api(`/api/books/${bookId}`, { token: a.token });
    expect(detail.status).toBe(200);
    const chapter = await (await api(`/api/books/${bookId}/chapters/1`, { token: a.token })).json();
    expect(chapter.content_html).toContain('Doan mot');
    expect((await api(`/api/books/${bookId}/file`, { token: a.token })).status).toBe(200);
  });

  it('danh sách sách và lịch sử đọc của B không lộ sách của A', async () => {
    const list = await (await api('/api/books', { token: b.token })).json();
    expect(list).toEqual([]);
    const history = await (await api('/api/history', { token: b.token })).json();
    expect(history).toEqual([]);
  });

  it('không đăng nhập thì không truy cập được các endpoint dữ liệu', async () => {
    for (const path of ['/api/books', '/api/history', '/api/last-read', '/api/settings', `/api/books/${bookId}`]) {
      expect((await api(path)).status).toBe(401);
    }
  });
});
