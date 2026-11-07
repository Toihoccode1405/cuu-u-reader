# Spec 04 - Font tự host

## Mục tiêu
Bỏ phụ thuộc Google Fonts: nhanh hơn (không thêm kết nối ngoài, font cache immutable 1 năm), riêng tư hơn, CSP chặt hơn.

## Hành vi
- Font đọc truyện còn lại: Athelas, Palatino, Charter (font hệ thống), Lora, Literata, Merriweather, Noto Serif, Be Vietnam Pro, Inter (tự host qua `@fontsource`).
- Mỗi font có subset latin và vietnamese; trình duyệt chỉ tải subset và độ đậm thật sự cần.
- Font đã bị bỏ khỏi danh sách (Newsreader, EB Garamond, Playfair, ...) nếu còn trong cài đặt đã lưu thì hiển thị bằng Athelas, không lỗi.
- CSP không còn `fonts.googleapis.com` / `fonts.gstatic.com` (cả `_headers` lẫn Worker).

## Kiểm thử
- E2E `e2e/tests/fonts.spec.js`: không có request tới origin khác, font Literata có chữ tiếng Việt tải được từ cùng origin, CSP không nhắc Google.
- Prod: header CSP mới, file woff2 trả 200 `font/woff2`, `Cache-Control: immutable`.
