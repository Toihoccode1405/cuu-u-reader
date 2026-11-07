import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, registerUser, buildEpub, uploadBook } from './helpers.js';

// Giờ giả: luật tu vi phụ thuộc thời gian thật giữa các lần báo đọc, nên test điều khiển đồng hồ
const START = new Date('2026-01-01T00:00:00Z').getTime();
let now;
const advance = (seconds) => {
  now += seconds * 1000;
  vi.setSystemTime(now);
};
beforeEach(() => {
  now = START;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

const words = (n) => Array(n).fill('tu').join(' ');
// Mỗi phần tử là số từ của một đoạn; các đoạn nằm trong cùng một chương
const chapterOf = (paras) => paras.map(words).join('</p><p>');

async function bookWith(paraWords, chapters = 1) {
  const user = await registerUser();
  const { book } = await uploadBook(
    user.token,
    await buildEpub({ chapters: Array.from({ length: chapters }, () => chapterOf(paraWords)) })
  );
  return { ...user, book };
}

const report = (token, body) => api('/api/reading/report', { method: 'POST', token, body });
const cultivation = async (token) => (await api('/api/cultivation', { token })).json();

describe('S6 - Tu vi: trạng thái ban đầu', () => {
  it('người đọc mới ở Ngưng Khí tầng 1 của Bước thứ nhất với 0 tu vi, hệ thống đang bật', async () => {
    const { token } = await registerUser();
    const res = await api('/api/cultivation', { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      tu_vi: 0,
      enabled: true,
      realm: { name: 'Ngưng Khí', tang: 1, buoc: 1 },
    });
  });
});

describe('S6 - Tu vi: cộng theo số từ đã đọc thật', () => {
  it('báo đã đọc các đoạn thì cộng đúng số từ của các đoạn đó', async () => {
    const { token, book } = await bookWith([100, 200, 300]);
    const res = await report(token, { book_id: book.id, chapter_index: 1, from_para: 0, to_para: 1, seconds: 60 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ gained: 300, tu_vi: 300, breakthrough: false });
    expect((await cultivation(token)).tu_vi).toBe(300);
  });
});

describe('S6 - Tu vi: không cộng khi lướt', () => {
  it('đọc nhanh hơn 1200 từ/phút thì chỉ cộng theo thời gian khai', async () => {
    const { token, book } = await bookWith([300]);
    const res = await report(token, { book_id: book.id, chapter_index: 1, from_para: 0, to_para: 0, seconds: 3 });
    expect((await res.json()).gained).toBe(60); // 3 giây x 20 từ/giây
  });

  it('khai thời gian dài hơn thời gian thật trôi qua từ lần báo trước thì chỉ tính thời gian thật', async () => {
    const { token, book } = await bookWith([1000]);
    const one = { book_id: book.id, chapter_index: 1, from_para: 0, to_para: 0 };
    await report(token, { ...one, seconds: 60 });
    advance(10);
    const res = await report(token, { ...one, seconds: 60 }); // khai 60s nhưng mới trôi 10s
    expect((await res.json()).gained).toBe(200);
  });

  it('báo liên tiếp ngay lập tức không cộng thêm gì', async () => {
    const { token, book } = await bookWith([1000]);
    const one = { book_id: book.id, chapter_index: 1, from_para: 0, to_para: 0, seconds: 60 };
    await report(token, one);
    const res = await report(token, one);
    expect((await res.json()).gained).toBe(0);
  });

  it('một lần báo tối đa 120 giây dù khai nhiều hơn', async () => {
    const { token, book } = await bookWith([5000]);
    const res = await report(token, { book_id: book.id, chapter_index: 1, from_para: 0, to_para: 0, seconds: 9999 });
    expect((await res.json()).gained).toBe(2400);
  });
});

describe('S6 - Tu vi: đọc lại vẫn cộng, đoạn ngoài phạm vi bị bỏ qua', () => {
  it('đọc lại cùng một đoạn vẫn được cộng', async () => {
    const { token, book } = await bookWith([300]);
    const one = { book_id: book.id, chapter_index: 1, from_para: 0, to_para: 0, seconds: 60 };
    await report(token, one);
    advance(60);
    await report(token, one);
    expect((await cultivation(token)).tu_vi).toBe(600);
  });

  it('đoạn vượt quá cuối chương chỉ tính các đoạn có thật', async () => {
    const { token, book } = await bookWith([100, 200]);
    const res = await report(token, { book_id: book.id, chapter_index: 1, from_para: 0, to_para: 99, seconds: 60 });
    expect((await res.json()).gained).toBe(300);
  });

  it('đoạn bắt đầu sau cuối chương hoặc khoảng ngược thì không cộng', async () => {
    const { token, book } = await bookWith([100, 200]);
    const a = await report(token, { book_id: book.id, chapter_index: 1, from_para: 50, to_para: 60, seconds: 60 });
    expect((await a.json()).gained).toBe(0);
    advance(60);
    const b = await report(token, { book_id: book.id, chapter_index: 1, from_para: 1, to_para: 0, seconds: 60 });
    expect((await b.json()).gained).toBe(0);
  });
});

describe('S6 - Cảnh giới và đột phá', () => {
  // Chương gồm 16 đoạn 1000 từ; mỗi lần báo một đoạn trong 60 giây thật
  async function readOneParagraphTimes(token, bookId, times) {
    let last;
    for (let i = 0; i < times; i++) {
      last = await (await report(token, { book_id: bookId, chapter_index: 1, from_para: i, to_para: i, seconds: 60 })).json();
      advance(60);
    }
    return last;
  }

  it('còn thiếu 1000 từ tới Trúc Cơ thì vẫn ở Ngưng Khí tầng 9, đủ mốc thì đột phá sang Trúc Cơ tầng 1', async () => {
    const { token, book } = await bookWith(Array(16).fill(1000));
    const before = await readOneParagraphTimes(token, book.id, 14); // 14.000 từ
    expect(before).toMatchObject({ tu_vi: 14000, realm: { name: 'Ngưng Khí', tang: 9 } });

    const res = await (await report(token, { book_id: book.id, chapter_index: 1, from_para: 14, to_para: 14, seconds: 60 })).json();
    expect(res).toMatchObject({ tu_vi: 15000, breakthrough: true, realm: { name: 'Trúc Cơ', tang: 1, buoc: 1 } });
  });

  it('lên tầng trong cùng cảnh giới cũng là đột phá', async () => {
    const { token, book } = await bookWith(Array(4).fill(1000));
    // Ngưng Khí 0..15000 chia 9 tầng, mỗi tầng ~1666,7 từ: 1000 từ vẫn tầng 1, 2000 từ lên tầng 2
    const first = await readOneParagraphTimes(token, book.id, 1);
    expect(first).toMatchObject({ breakthrough: false, realm: { name: 'Ngưng Khí', tang: 1 } });
    const second = await (await report(token, { book_id: book.id, chapter_index: 1, from_para: 1, to_para: 1, seconds: 60 })).json();
    expect(second).toMatchObject({ tu_vi: 2000, breakthrough: true, realm: { name: 'Ngưng Khí', tang: 2 } });
  });
});

describe('S6b - Quyền, CSRF và dữ liệu sai', () => {
  const one = (book) => ({ book_id: book.id, chapter_index: 1, from_para: 0, to_para: 0, seconds: 60 });

  it('người khác không báo đọc vào sách của bạn để lấy tu vi', async () => {
    const owner = await bookWith([300]);
    const other = await registerUser();
    expect((await report(other.token, one(owner.book))).status).toBe(404);
    expect((await cultivation(other.token)).tu_vi).toBe(0);
    expect((await cultivation(owner.token)).tu_vi).toBe(0);
  });

  it('không đăng nhập thì 401, origin lạ hoặc thiếu origin thì 403', async () => {
    const { token, book } = await bookWith([300]);
    expect((await report(undefined, one(book))).status).toBe(401);
    expect((await api('/api/cultivation')).status).toBe(401);
    const evil = await api('/api/reading/report', { method: 'POST', token, body: one(book), origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    const none = await api('/api/reading/report', { method: 'POST', token, body: one(book), origin: null });
    expect(none.status).toBe(403);
    expect((await cultivation(token)).tu_vi).toBe(0);
  });

  it('dữ liệu sai định dạng hoặc chương không tồn tại bị từ chối, không đổi tu vi', async () => {
    const { token, book } = await bookWith([300]);
    expect((await report(token, { ...one(book), seconds: 'nhieu' })).status).toBe(400);
    expect((await report(token, { ...one(book), from_para: 1.5 })).status).toBe(400);
    expect((await report(token, { ...one(book), chapter_index: 99 })).status).toBe(400);
    expect((await report(token, { ...one(book), chapter_index: 0 })).status).toBe(400);
    expect((await report(token, { ...one(book), seconds: -50 })).status).toBe(200); // thời gian âm coi như 0
    expect((await cultivation(token)).tu_vi).toBe(0);
  });

  it('xóa sách không làm mất tu vi đã tích lũy', async () => {
    const { token, book } = await bookWith([300]);
    await report(token, one(book));
    const del = await api(`/api/books/${book.id}`, { method: 'DELETE', token });
    expect(del.ok).toBe(true);
    expect((await cultivation(token)).tu_vi).toBe(300);
  });
});

describe('S6c - Cộng hồi tố từ tiến độ đọc có sẵn', () => {
  const backfill = (token) => api('/api/cultivation/backfill', { method: 'POST', token });
  const setProgress = (token, bookId, chapter) =>
    api(`/api/books/${bookId}/progress`, { method: 'POST', token, body: { chapter_index: chapter, scroll_percent: 0, para_index: 0 } });

  it('cộng số từ của các chương đứng trước chương đang đọc, chương đang đọc dở không tính', async () => {
    const { token, book } = await bookWith([100, 200], 3); // mỗi chương 300 từ
    await setProgress(token, book.id, 3);
    const res = await backfill(token);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ gained: 600, tu_vi: 600 });
  });

  it('chỉ chạy một lần dù gọi nhiều lần', async () => {
    const { token, book } = await bookWith([100, 200], 3);
    await setProgress(token, book.id, 3);
    await backfill(token);
    const again = await (await backfill(token)).json();
    expect(again).toMatchObject({ gained: 0, tu_vi: 600 });
    expect((await cultivation(token)).tu_vi).toBe(600);
  });

  it('cộng dồn nhiều sách và không tính sách người khác', async () => {
    const a = await bookWith([100], 3); // 100 từ/chương
    await setProgress(a.token, a.book.id, 3); // 2 chương = 200
    const { book: b } = await uploadBook(a.token, await buildEpub({ chapters: [chapterOf([50]), chapterOf([50])], title: 'Sach Hai' }));
    await setProgress(a.token, b.id, 2); // 1 chương = 50
    const other = await bookWith([999], 3);
    await setProgress(other.token, other.book.id, 3);
    expect((await (await backfill(a.token)).json()).tu_vi).toBe(250);
  });

  it('người chưa đọc gì thì tu vi vẫn là 0', async () => {
    const { token } = await registerUser();
    expect(await (await backfill(token)).json()).toMatchObject({ gained: 0, tu_vi: 0 });
  });

  it('tính đúng cảnh giới, tầng và Bước ở mốc xa (3,25 triệu từ là Thiên Nhân Suy Kiếp tầng 3 của Bước thứ hai)', async () => {
    const big = Array(250_000).fill('a').join(' ');
    const user = await registerUser();
    const chapters = Array.from({ length: 14 }, () => big);
    const { book } = await uploadBook(user.token, await buildEpub({ chapters }));
    await setProgress(user.token, book.id, 14); // 13 chương trước đó x 250.000 từ
    const res = await (await backfill(user.token)).json();
    expect(res).toMatchObject({
      tu_vi: 3_250_000,
      realm: { name: 'Thiên Nhân Suy Kiếp', tang: 3, tangs: 5, buoc: 2 },
    });
  }, 60_000);

  it('người khác không chạy được cộng hồi tố thay bạn, thiếu origin bị 403', async () => {
    const { token } = await registerUser();
    expect((await api('/api/cultivation/backfill', { method: 'POST' })).status).toBe(401);
    expect((await api('/api/cultivation/backfill', { method: 'POST', token, origin: null })).status).toBe(403);
  });
});

describe('S6 - Công tắc hệ thống tu tiên', () => {
  const toggle = (token, enabled) => api('/api/cultivation', { method: 'PUT', token, body: { enabled } });

  it('tắt chỉ ẩn khỏi giao diện: máy chủ vẫn ghi tu vi, bật lại không mất gì', async () => {
    const { token, book } = await bookWith([300]);
    expect((await toggle(token, false)).status).toBe(200);
    expect((await cultivation(token)).enabled).toBe(false);

    await report(token, { book_id: book.id, chapter_index: 1, from_para: 0, to_para: 0, seconds: 60 });
    expect((await toggle(token, true)).status).toBe(200);
    expect(await cultivation(token)).toMatchObject({ enabled: true, tu_vi: 300 });
  });

  it('chỉ nhận true/false, cần đăng nhập và origin hợp lệ', async () => {
    const { token } = await registerUser();
    expect((await toggle(token, 'khong')).status).toBe(400);
    expect((await toggle(undefined, false)).status).toBe(401);
    expect((await api('/api/cultivation', { method: 'PUT', token, body: { enabled: false }, origin: 'https://evil.example' })).status).toBe(403);
    expect((await cultivation(token)).enabled).toBe(true);
  });
});

describe('S6 - Báo đọc có thời điểm (gom khi offline rồi gửi lại)', () => {
  const para = (book) => ({ book_id: book.id, chapter_index: 1, from_para: 0, to_para: 0 });

  it('gửi lại hàng đợi theo thứ tự: mỗi báo cáo được tính theo thời điểm thật lúc đọc', async () => {
    const { token, book } = await bookWith([1000]);
    advance(150); // đã mất mạng 150 giây, lúc này mới gửi bù ba báo cáo
    const sent = [];
    for (const at of [START + 50_000, START + 100_000, START + 150_000]) {
      sent.push(await (await report(token, { ...para(book), seconds: 50, at })).json());
    }
    expect(sent.map((r) => r.gained)).toEqual([1000, 1000, 1000]);
    expect((await cultivation(token)).tu_vi).toBe(3000);
  });

  it('khai thời điểm ở tương lai thì chỉ tính tới hiện tại', async () => {
    const { token, book } = await bookWith([1000]);
    await report(token, { ...para(book), seconds: 60 });
    advance(10);
    const res = await report(token, { ...para(book), seconds: 60, at: now + 3_600_000 });
    expect((await res.json()).gained).toBe(200);
  });

  it('khai thời điểm cũ hơn lần báo trước thì không có thời gian để cộng', async () => {
    const { token, book } = await bookWith([1000]);
    advance(100);
    await report(token, { ...para(book), seconds: 60 });
    const res = await report(token, { ...para(book), seconds: 60, at: START - 1000 });
    expect((await res.json()).gained).toBe(0);
  });
});
