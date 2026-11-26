# 12 — Ảnh nền Vương Lâm khi đọc truyện

## Mục tiêu
Ảnh Vương Lâm (Tiên Nghịch) phủ kín cả màn hình phía sau thẻ chữ cho đỡ khô khan. Ảnh lộ mờ mờ qua cả thẻ chữ nhưng chữ vẫn rõ. Không có hiệu ứng động (bản thử pixel đánh nhau và nhân vật bên lề đã bỏ vì không hợp).

## Quy tắc
- Một lớp nền cố định (`.reader-bg`, `position: fixed; inset: 0`, `z-index: -1` trong `.reader-wrapper` có `isolation: isolate`) phủ trọn khung nhìn, đứng yên khi cuộn. Không dùng `background-attachment: fixed` để cuộn không giật.
- Hai ảnh riêng, CSS chọn theo `max-width: 640px`, nên trình duyệt chỉ tải ảnh khớp màn hình:
  - máy tính: `vuong-lam-desktop.webp` 2560×1440 (~151 KB), nguồn wallhaven 7j3399.
  - điện thoại: `vuong-lam-phone.webp` 810×1440 (~97 KB), cắt dọc 9:16 quanh nhân vật từ wallhaven 3q99qd.
  Ngân sách: máy tính <= 250 KB, điện thoại <= 150 KB (có test).
- Lớp phủ theo theme (`.reader-bg::after`: trắng, sepia hoặc đen nhạt) cho ảnh không chói. Độ đậm lấy từ thanh trượt "Độ mờ ảnh" (0–90%, mặc định 50%, lưu `ambienceDim` trong cài đặt); biến CSS `--scrim-a`.
- **Thẻ chữ mờ mờ**: nền thẻ = màu thẻ của theme 76% đục (`color-mix`). Thấy ảnh qua thẻ nhưng chữ vẫn tương phản >= 7:1 trong trường hợp xấu nhất (ảnh trắng nhất hoặc đen nhất phía sau lớp phủ). Muốn rõ chữ hơn thì tăng độ đục, muốn thấy ảnh hơn thì giảm; test chặn trong khoảng 60–85%.
- Công tắc **"Ảnh nền"** trong cài đặt đọc, lưu trong cài đặt (`ambience`, đồng bộ lên tài khoản). Bật sẵn trên mọi thiết bị. Tắt thì không có lớp nền và không tải ảnh nào. Nút "Đặt lại" giữ lựa chọn này.
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

## Ảnh riêng do người dùng chọn (thêm sau)
Trong cài đặt đọc, dưới công tắc "Ảnh nền" có mục chọn ảnh: khung xem trước, nút "Chọn ảnh từ máy", nút "Dùng lại ảnh Vương Lâm" (chỉ hiện khi đang dùng ảnh riêng) và thanh trượt "Độ mờ ảnh".
- **Chỉ lưu trong trình duyệt của máy này** (IndexedDB, DB `cuu_u_bg`, kho `img`, khóa `desktop` hoặc `phone`, giá trị là Blob WebP). Không gửi lên server, không đồng bộ; máy khác hay xóa dữ liệu trình duyệt thì quay về ảnh Vương Lâm. Chỉ độ đậm lớp phủ (`ambienceDim`) đồng bộ như mọi cài đặt khác.
- **Hai ô riêng**: `phone` khi rộng <= 640px, còn lại là `desktop`. Ô nào trống thì dùng ảnh mặc định của loại máy đó.
- **Xử lý ngay trên máy**: chỉ nhận JPG, PNG, WebP (từ chối SVG vì có thể chứa script và mọi loại khác), tối đa 20 MB; thu nhỏ cạnh dài còn <= 2560px (máy tính) hoặc <= 1440px (điện thoại), nén WebP 82%. Lỗi hiện trong `role="alert"` (sai định dạng, quá lớn, ảnh hỏng, không lưu được); ảnh cũ giữ nguyên khi lỗi.
- Ảnh hiển thị qua blob URL tạo khi vào màn đọc và thu hồi khi rời; CSP `img-src` đã có `blob:` nên không đổi. Trong lúc đọc IndexedDB lớp nền tạm không có ảnh để khỏi tải ảnh mặc định thừa.
- **Giữ chữ đọc được với ảnh bất kỳ**: ảnh người dùng có thể rất sáng hoặc rối, nên chỉ lớp phủ chỉnh được; thẻ chữ luôn 76% đục. Thanh trượt cho kéo về 0% (không phủ gì) theo ý người dùng. Ở mặc định 50% chữ đạt >= 7:1; kéo xuống 0% với ảnh trắng hoặc đen hoàn toàn thì tương phản giảm nhưng vẫn >= 4,5:1 (mức AA) ở cả ba theme, là sàn test giữ (đo: sepia ảnh đen, 30% còn 6,9:1).

Kiểm thử thêm: `e2e/tests/bg-custom.spec.js` (5 test: chọn ảnh ở máy tính thì thu nhỏ, nén WebP, không có request mạng nào, giữ sau khi tải lại và không tải ảnh mặc định; hai ô độc lập; "Dùng lại ảnh Vương Lâm" xóa ảnh riêng; từ chối SVG, file > 20 MB và ảnh hỏng mà ảnh cũ còn nguyên; thanh trượt 0–90 và tương phản >= 4,5:1 ở 0%). Đã kiểm đột biến: bỏ giới hạn 20 MB, bỏ thu nhỏ, gộp hai ô, cho phép SVG, đổi mức thấp nhất của thanh trượt. Bỏ trạng thái "đang đọc" (loading) không bị bắt vì trong luồng thật IndexedDB luôn đọc xong trước khi màn đọc mở.
