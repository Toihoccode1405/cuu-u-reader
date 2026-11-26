# 12 — Ảnh nền Vương Lâm khi đọc truyện

## Mục tiêu
Ảnh Vương Lâm (Tiên Nghịch) phủ kín cả màn hình phía sau thẻ chữ cho đỡ khô khan. Ảnh lộ mờ mờ qua cả thẻ chữ nhưng chữ vẫn rõ. Không có hiệu ứng động (bản thử pixel đánh nhau và nhân vật bên lề đã bỏ vì không hợp).

## Quy tắc
- Một lớp nền cố định (`.reader-bg`, `position: fixed; inset: 0`, `z-index: -1` trong `.reader-wrapper` có `isolation: isolate`) phủ trọn khung nhìn, đứng yên khi cuộn. Không dùng `background-attachment: fixed` để cuộn không giật.
- Hai ảnh riêng, CSS chọn theo `max-width: 640px`, nên trình duyệt chỉ tải ảnh khớp màn hình:
  - máy tính: `vuong-lam-desktop.webp` 2560×1440 (~151 KB), nguồn wallhaven 7j3399.
  - điện thoại: `vuong-lam-phone.webp` 810×1440 (~97 KB), cắt dọc 9:16 quanh nhân vật từ wallhaven 3q99qd.
  Ngân sách: máy tính <= 250 KB, điện thoại <= 150 KB (có test).
- Lớp phủ theo theme (`.reader-bg::after`) cho ảnh không chói: trắng 50%, sepia 52%, tối 50% (điện thoại 45%, 48%, 30%).
- **Thẻ chữ mờ mờ**: nền thẻ = màu thẻ của theme 72% đục (`color-mix`). Thấy ảnh qua thẻ nhưng chữ vẫn tương phản >= 7:1 trong trường hợp xấu nhất (ảnh trắng nhất hoặc đen nhất phía sau lớp phủ). Muốn rõ chữ hơn thì tăng độ đục, muốn thấy ảnh hơn thì giảm; test chặn trong khoảng 60–85%.
- Công tắc **"Ảnh nền Vương Lâm"** trong cài đặt đọc, lưu trong cài đặt (`ambience`, đồng bộ lên tài khoản). Bật sẵn trên mọi thiết bị. Tắt thì không có lớp nền và không tải ảnh nào. Nút "Đặt lại" giữ lựa chọn này.
- Không gọi API, không timer, không script chạy nền. CSP không đổi (`img-src 'self'`); ảnh là asset cùng nguồn, Vite băm tên và Service Worker cache như asset khác.

## Xử lý ảnh
Hai ảnh gốc lưu ở `docs/brand/wallhaven-7j3399.jpg` (4000×2250) và `docs/brand/wallhaven-3q99qd.jpg` (2026×2701). Đổi cỡ bằng Pillow (LANCZOS) rồi WebP chất lượng 82. Muốn đổi ảnh chỉ cần thay hai file WebP trong `reader_frontend/src/assets/` giữ nguyên tên.

## Bản quyền (người dùng tự quyết)
Cả hai ảnh lấy từ wallhaven.cc (đăng bởi người dùng, "nguồn không rõ", quyền thuộc chủ sở hữu gốc), là tranh dựng nhân vật Vương Lâm của Tiên Nghịch. Dự án này dùng riêng một người. Nếu đưa cho người khác dùng thì cần xác minh bản quyền hoặc thay ảnh.

## Kiểm thử
`e2e/tests/ambience.spec.js`:
1. Máy tính 1440×900: lớp nền phủ đúng (0,0,1440,900), thẻ chữ nằm trên lớp nền, đứng yên sau khi cuộn, chỉ tải ảnh máy tính, không tràn ngang, không lỗi console.
2. Điện thoại 375×700: tương tự với ảnh điện thoại.
3. Ngân sách dung lượng ảnh.
4. Tương phản chữ: 2 kích thước × 3 theme, tính trường hợp xấu nhất theo lớp phủ thật đọc từ CSS.
5. Công tắc: bật sẵn, tắt thì mất lớp nền và lưu `ambience: false`; tắt từ trước thì không có lớp nền và không tải ảnh; có sẵn và đang bật trên điện thoại.

Độ đẹp (ảnh có lộ ra đúng mức, hài hòa với từng theme) đánh giá bằng ảnh chụp màn hình.
