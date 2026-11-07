import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { api, registerUser, buildEpub, buildAnchoredEpub, uploadBook } from './helpers.js';

const batch = (token, bookId, chapters, opts = {}) =>
  api(`/api/books/${bookId}/chapters/batch`, { method: 'POST', token, body: { chapters }, ...opts });

const extractedOf = async (token, bookId) =>
  (await (await api(`/api/books/${bookId}/extracted`, { token })).json()).extracted;

async function newBook(chapters = ['mot', 'hai', 'ba']) {
  const user = await registerUser();
  const { book } = await uploadBook(user.token, await buildEpub({ chapters }));
  return { ...user, book };
}

describe('S3 - Chương nhiều trong một file (anchor)', () => {
  it('mỗi chương chỉ chứa nội dung của chính nó, không lẫn chương kế', async () => {
    const { token } = await registerUser();
    const { book } = await uploadBook(token, await buildAnchoredEpub());
    const read = async (i) => (await (await api(`/api/books/${book.id}/chapters/${i}`, { token })).json()).content_html;
    const [c1, c2, c3] = [await read(1), await read(2), await read(3)];
    expect(c1).toContain('Noi dung cua Chuong A');
    expect(c1).not.toContain('Chuong B');
    expect(c2).toContain('Noi dung cua Chuong B');
    expect(c2).not.toContain('Chuong A');
    expect(c2).not.toContain('Chuong C');
    expect(c3).toContain('Noi dung cua Chuong C');
  });
});

describe('S3 - Tách chương: danh sách chương đã tách', () => {
  it('sách mới đưa lên chưa có chương nào được tách', async () => {
    const { token, book } = await newBook();
    const res = await api(`/api/books/${book.id}/extracted`, { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 3, extracted: [] });
  });

  it('đọc một chương lần đầu cũng làm chương đó thành chương đã tách', async () => {
    const { token, book } = await newBook();
    await api(`/api/books/${book.id}/chapters/2`, { token });
    // ghi cache chạy nền: chờ nó xong
    let extracted = [];
    for (let i = 0; i < 20 && !extracted.includes(2); i++) {
      extracted = await extractedOf(token, book.id);
      if (!extracted.includes(2)) await new Promise((r) => setTimeout(r, 25));
    }
    expect(extracted).toEqual([2]);
  });
});

describe('S3 - Tách chương: gửi lô chương từ trình duyệt', () => {
  it('lưu các chương gửi lên và đọc lại được đúng nội dung, đã lọc sạch', async () => {
    const { token, book } = await newBook();
    const res = await batch(token, book.id, [
      { index: 1, raw_html: '<html><body><h2>Chuong 1</h2><p>Noi dung moi mot <b>dam</b></p></body></html>' },
      { index: 2, raw_html: '<p onclick="x()">Hai <script>alert(1)</script><img src=x onerror=y()></p>' },
    ]);
    expect(res.status).toBe(200);
    expect((await res.json()).stored).toBe(2);

    const c1 = await (await api(`/api/books/${book.id}/chapters/1`, { token })).json();
    expect(c1.content_html).toContain('Noi dung moi mot <b>dam</b>');
    expect(c1.content_html).not.toContain('Chuong 1'); // bỏ dòng tiêu đề lặp lại
    const c2 = await (await api(`/api/books/${book.id}/chapters/2`, { token })).json();
    expect(c2.content_html).toContain('Hai');
    expect(c2.content_html).not.toMatch(/script|onclick|onerror|<img/i);

    expect(await extractedOf(token, book.id)).toEqual([1, 2]);
  });

  it('chương đã tách đọc được ngay cả khi không còn file EPUB gốc để xử lý', async () => {
    const { token, book } = await newBook();
    await batch(token, book.id, [1, 2, 3].map((i) => ({ index: i, raw_html: `<p>Doan ${i}</p>` })));
    // Mô phỏng mất dữ liệu EPUB gốc: nếu đọc chương còn cần giải nén EPUB thì sẽ lỗi
    await env.DB.prepare('DELETE FROM book_chunks WHERE book_id = ?').bind(book.id).run();
    for (const i of [1, 2, 3]) {
      const ch = await (await api(`/api/books/${book.id}/chapters/${i}`, { token })).json();
      expect(ch.content_html).toContain(`Doan ${i}`);
    }
  });

  it('không ghi đè chương người đọc đã tự sửa', async () => {
    const { token, book } = await newBook();
    await api(`/api/books/${book.id}/chapters/1`, { method: 'PUT', token, body: { content_html: '<p>Ban da sua</p>' } });
    const res = await batch(token, book.id, [{ index: 1, raw_html: '<p>Ban goc tu EPUB</p>' }]);
    expect(res.status).toBe(200);
    const ch = await (await api(`/api/books/${book.id}/chapters/1`, { token })).json();
    expect(ch.content_html).toContain('Ban da sua');
    expect(ch.content_html).not.toContain('Ban goc');
  });

  it('gửi lại cùng một lô không làm hỏng gì (làm tiếp sau khi bị ngắt)', async () => {
    const { token, book } = await newBook();
    const chapters = [1, 2, 3].map((i) => ({ index: i, raw_html: `<p>Doan ${i}</p>` }));
    expect((await batch(token, book.id, chapters)).status).toBe(200);
    expect((await batch(token, book.id, chapters)).status).toBe(200);
    expect(await extractedOf(token, book.id)).toEqual([1, 2, 3]);
  });

  it('bỏ qua chương rỗng và chỉ số ngoài phạm vi', async () => {
    const { token, book } = await newBook();
    const res = await batch(token, book.id, [
      { index: 1, raw_html: '   ' },
      { index: 99, raw_html: '<p>ngoai pham vi</p>' },
      { index: 0, raw_html: '<p>khong hop le</p>' },
      { index: 3, raw_html: '<p>hop le</p>' },
    ]);
    expect((await res.json()).stored).toBe(1);
    expect(await extractedOf(token, book.id)).toEqual([3]);
  });

  it('từ chối lô quá lớn hoặc sai định dạng', async () => {
    const { token, book } = await newBook();
    const tooMany = Array.from({ length: 41 }, (_, i) => ({ index: (i % 3) + 1, raw_html: '<p>x</p>' }));
    expect((await batch(token, book.id, tooMany)).status).toBe(413);
    expect((await batch(token, book.id, 'khong-phai-mang')).status).toBe(400);
    const huge = [{ index: 1, raw_html: '<p>' + 'a'.repeat(600_000) + '</p>' }];
    expect((await batch(token, book.id, huge)).status).toBe(413);
  });
});

describe('S2 - Quyền sở hữu và CSRF của lô chương', () => {
  it('người khác không gửi được chương vào sách của bạn và không xem được danh sách', async () => {
    const owner = await newBook();
    const other = await registerUser();
    expect((await batch(other.token, owner.book.id, [{ index: 1, raw_html: '<p>pha</p>' }])).status).toBe(404);
    expect((await api(`/api/books/${owner.book.id}/extracted`, { token: other.token })).status).toBe(404);
    expect(await extractedOf(owner.token, owner.book.id)).toEqual([]);
  });

  it('không đăng nhập thì bị từ chối, origin lạ bị chặn', async () => {
    const { token, book } = await newBook();
    expect((await batch(undefined, book.id, [{ index: 1, raw_html: '<p>x</p>' }])).status).toBe(401);
    const evil = await batch(token, book.id, [{ index: 1, raw_html: '<p>x</p>' }], { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
  });
});
