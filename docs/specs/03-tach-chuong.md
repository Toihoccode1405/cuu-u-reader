# Spec 03 - Tách chương

## Mục tiêu
Mở chương lần đầu < 1.5s; chương đã tách < 300ms. Trước đây Worker phải giải nén cả EPUB (tới ~40MB) cho chương đầu tiên.

## Hành vi
- **Tách chương**: sau khi đưa sách lên, trình duyệt cắt sẵn từng chương từ file EPUB đang có trong tay và gửi lên máy chủ theo lô.
- **Tách bù**: khi mở một sách còn chương chưa tách, trình duyệt tải EPUB gốc và tách các chương còn thiếu ở nền. Chỉ tải EPUB khi thật sự còn thiếu.
- Làm tiếp được nếu bị ngắt. Đăng xuất hủy tiến trình. Hiện nhãn tiến độ nhỏ "Đang chuẩn bị chương: x/y".
- Chương tách không bao giờ ghi đè chương đã có (kể cả chương người đọc đã sửa tay).
- Chương quá lớn (> 490k ký tự) được bỏ qua ở trình duyệt; Worker tự tách khi người đọc mở chương đó.

## API
- `GET /api/books/:id/extracted` -> `{ total, extracted: [index...] }` (404 nếu không phải sách của bạn).
- `POST /api/books/:id/chapters/batch` body `{ chapters: [{ index, raw_html }] }` -> `{ stored }`.
  - Tối đa 40 chương/lô và 500.000 ký tự/chương (413). Sai định dạng: 400.
  - Server luôn lọc HTML (`cleanXhtml`) và bỏ tiêu đề lặp; không tin dữ liệu từ trình duyệt.
  - Chỉ số ngoài phạm vi hoặc chương rỗng bị bỏ qua. Ghi `ON CONFLICT DO NOTHING`.
  - Cần cookie phiên và Origin hợp lệ (CSRF).

## Mã dùng chung
`shared/epub-chapter.js` cắt chương theo anchor, dùng cho cả Worker và trình duyệt để hai nơi cắt giống hệt nhau.

## Kiểm thử
- API (Vitest): `cloudflare_worker/test/extract.test.js` (seam S2, S3).
- E2E (Playwright): `e2e/tests/extract.spec.js` (seam S5).
- Đã kiểm đột biến: bỏ kiểm tra sở hữu, cho phép ghi đè, bỏ lọc HTML đều làm test đỏ.
