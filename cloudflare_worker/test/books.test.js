import { describe, it, expect } from 'vitest';
import { api, registerUser, buildEpub, uploadBook } from './helpers.js';

describe('S3 - Sách và chương', () => {
  it('đưa sách lên rồi đọc được từng chương, có chương trước và chương sau', async () => {
    const { token } = await registerUser();
    const { res, book } = await uploadBook(
      token,
      await buildEpub({ title: 'Tien Nghich', chapters: ['Noi dung mot', 'Noi dung hai', 'Noi dung ba'] })
    );
    expect(res.status).toBe(200);
    expect(book).toMatchObject({ title: 'Tien Nghich', total_chapters: 3 });

    const detail = await (await api(`/api/books/${book.id}`, { token })).json();
    expect(detail.chapters.map((c) => c.title)).toEqual(['Chuong 1', 'Chuong 2', 'Chuong 3']);

    const ch2 = await (await api(`/api/books/${book.id}/chapters/2`, { token })).json();
    expect(ch2.content_html).toContain('Noi dung hai');
    expect(ch2).toMatchObject({ prev_index: 1, next_index: 3, total_chapters: 3 });

    const ch1 = await (await api(`/api/books/${book.id}/chapters/1`, { token })).json();
    expect(ch1.prev_index).toBeNull();
    const ch3 = await (await api(`/api/books/${book.id}/chapters/3`, { token })).json();
    expect(ch3.next_index).toBeNull();
  });

  it('thư các liệt kê sách vừa đưa lên', async () => {
    const { token } = await registerUser();
    await uploadBook(token, await buildEpub({ title: 'Sach Mot' }));
    const list = await (await api('/api/books', { token })).json();
    expect(list.map((b) => b.title)).toEqual(['Sach Mot']);
  });

  it('từ chối file không phải EPUB (ZIP)', async () => {
    const { token } = await registerUser();
    const { res } = await uploadBook(token, new TextEncoder().encode('khong phai epub'), 'gia.epub');
    expect(res.status).toBe(400);
  });

  it('tải lại đúng file EPUB đã đưa lên', async () => {
    const { token } = await registerUser();
    const bytes = await buildEpub({ title: 'Tai Ve' });
    const { book } = await uploadBook(token, bytes);
    const res = await api(`/api/books/${book.id}/file`, { token });
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it('ghi tiến độ đọc rồi mở lại sách thấy đúng vị trí', async () => {
    const { token } = await registerUser();
    const { book } = await uploadBook(token, await buildEpub({ chapters: ['a', 'b', 'c'] }));
    const save = await api(`/api/books/${book.id}/progress`, {
      method: 'POST', token, body: { chapter_index: 3, scroll_percent: 42, para_index: 5 },
    });
    expect(save.status).toBe(200);

    const detail = await (await api(`/api/books/${book.id}`, { token })).json();
    expect(detail.record).toMatchObject({ current_chapter: 3, scroll_percent: 42, para_index: 5 });
    const last = await (await api('/api/last-read', { token })).json();
    expect(last).toMatchObject({ book_id: book.id, chapter_index: 3 });
  });

  it('thêm rồi bỏ dấu trang bằng cách bấm lại cùng một đoạn', async () => {
    const { token } = await registerUser();
    const { book } = await uploadBook(token, await buildEpub());
    const add = await (await api(`/api/books/${book.id}/bookmarks`, {
      method: 'POST', token, body: { chapter_index: 1, para_index: 0, excerpt: 'Doan mot' },
    })).json();
    expect(add.removed).toBe(false);
    expect(await (await api(`/api/books/${book.id}/bookmarks`, { token })).json()).toHaveLength(1);

    const remove = await (await api(`/api/books/${book.id}/bookmarks`, {
      method: 'POST', token, body: { chapter_index: 1, para_index: 0 },
    })).json();
    expect(remove.removed).toBe(true);
    expect(await (await api(`/api/books/${book.id}/bookmarks`, { token })).json()).toHaveLength(0);
  });

  it('xóa sách thì sách biến mất khỏi thư các', async () => {
    const { token } = await registerUser();
    const { book } = await uploadBook(token, await buildEpub());
    expect((await api(`/api/books/${book.id}`, { method: 'DELETE', token })).status).toBe(200);
    expect((await api(`/api/books/${book.id}`, { token })).status).toBe(404);
    expect(await (await api('/api/books', { token })).json()).toEqual([]);
  });

  it('cài đặt đọc lưu rồi đọc lại đúng', async () => {
    const { token } = await registerUser();
    const settings = { theme: 'night', fontSize: 20 };
    expect((await api('/api/settings', { method: 'POST', token, body: { settings } })).status).toBe(200);
    expect((await (await api('/api/settings', { token })).json()).settings).toEqual(settings);
  });
});

describe('S3 - Sửa chương và chống XSS lưu trữ', () => {
  it('sửa chương rồi đọc lại thấy nội dung mới', async () => {
    const { token } = await registerUser();
    const { book } = await uploadBook(token, await buildEpub());
    const put = await api(`/api/books/${book.id}/chapters/1`, {
      method: 'PUT', token, body: { title: 'Moi', content_html: '<p>Da sua</p>' },
    });
    expect(put.status).toBe(200);
    const ch = await (await api(`/api/books/${book.id}/chapters/1`, { token })).json();
    expect(ch.content_html).toContain('Da sua');
  });

  it('lọc bỏ script, sự kiện và thẻ lạ nhưng giữ định dạng an toàn', async () => {
    const { token } = await registerUser();
    const { book } = await uploadBook(token, await buildEpub());
    const evil =
      '<p onclick="x()">Chao <script>alert(1)</script><img src=x onerror=alert(2)> <b>dam</b> <a href="javascript:alert(3)">link</a></p>';
    await api(`/api/books/${book.id}/chapters/1`, { method: 'PUT', token, body: { content_html: evil } });

    const html = (await (await api(`/api/books/${book.id}/chapters/1`, { token })).json()).content_html;
    expect(html).not.toMatch(/script|onerror|onclick|<img|javascript:|<a\b/i);
    expect(html).toContain('<b>dam</b>');
    expect(html).toContain('Chao');
  });

  it('từ chối nội dung rỗng hoặc không phải chuỗi', async () => {
    const { token } = await registerUser();
    const { book } = await uploadBook(token, await buildEpub());
    for (const content_html of ['', '   ', null, 123]) {
      const res = await api(`/api/books/${book.id}/chapters/1`, { method: 'PUT', token, body: { content_html } });
      expect(res.status).toBe(400);
    }
  });
});
