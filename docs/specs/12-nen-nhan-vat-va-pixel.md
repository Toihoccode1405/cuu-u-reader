# 12 — Nền nhân vật và pixel tu tiên khi đọc truyện

## Mục tiêu
Cho màn đọc truyện sinh động hơn mà không ảnh hưởng việc đọc: Vương Lâm (Tiên Nghịch) đứng ở lề trái, và khi chuột chỉ vào chữ thì hai tu sĩ pixel-art đánh nhau ở lề phải vài giây rồi biến mất.

## Quy tắc
- **Không bao giờ đè lên chữ.** Cả hai hiệu ứng chỉ nằm ngoài thẻ chữ (`.reader-card`, rộng tối đa 760px). Chữ luôn nằm trên nền đặc của thẻ, độ tương phản các theme không đổi.
- **Máy tính (viewport >= 1100px)**: nhân vật cố định ở lề trái (cao tối đa 60vh, rộng tối đa 340px, mép mờ dần); canvas pixel ở lề phải, đặt theo chiều cao chuột lúc bắt đầu.
- **Dưới 1100px (điện thoại, tablet)**: không có nhân vật bên lề và không có pixel; thay bằng dải ảnh mờ dần ở đầu chương, nằm trong thẻ, phía trên tiêu đề.
- **Công tắc** "Hiệu ứng nền và chiến đấu" trong tấm cài đặt đọc, lưu trong cài đặt (`ambience`, đồng bộ lên tài khoản như mọi cài đặt khác). Chưa chọn thì mặc định **bật** từ 641px trở lên, **tắt** trên điện thoại (<= 640px). Công tắc điều khiển cả nhân vật, dải ảnh và pixel. Nút "Đặt lại" giữ lựa chọn này.
- **Pixel-art**: tự vẽ bằng canvas 2D (`pixelFight.js`), không ảnh ngoài, không thư viện. Kiếm tu áo xanh (trái) và ma tu áo đỏ có sừng (phải), mỗi trận 4 chiêu theo thứ tự ngẫu nhiên, hai bên thay phiên: chém kiếm khí, phi kiếm / cầu ma khí, lôi kiếp, nổ linh lực. Một trận dài 3,6 giây, chỉ bắt đầu khi chuột **vào một đoạn khác** với đoạn trước và chưa có trận nào đang chạy. Chuột đứng yên trên một đoạn không lặp lại trận.
- **Chỉ chuột thật** (`pointerType === 'mouse'`). Cảm ứng không kích hoạt.
- **Tôn trọng `prefers-reduced-motion`**: nhân vật vẫn hiện (đứng yên), pixel không bao giờ chạy.
- **Tiết kiệm**: không chạy khi tab bị ẩn (đang đánh thì dừng); canvas chỉ vẽ trong lúc có trận, `requestAnimationFrame` dừng khi hết. Không có timer chạy nền.
- **Hover không gọi API và không đổi trạng thái ứng dụng** (không đụng tiến độ đọc). Một listener `pointermove` ở `document`, không render lại React.
- Ảnh tải lười: chỉ yêu cầu khi hiệu ứng bật và màn đọc đang hiển thị (nền CSS của phần tử chỉ tồn tại lúc đó). Mỗi bản ~31 KB, WebP, Vite băm tên và Service Worker cache như các asset khác. CSP không đổi (`img-src 'self'`).

## Xử lý ảnh
Ảnh gốc (365×547, tranh mực thủy mặc nền trắng ngả xanh) lưu ở `docs/brand/vuong-lam.jfif`. Hai bản WebP trong `reader_frontend/src/assets/`:
- `vuong-lam-light.webp`: chuẩn hóa mức sáng để nền thành trắng thuần; hiển thị với `mix-blend-mode: multiply` nên nền trắng biến mất trên theme trắng và sepia (sepia còn ngả màu giấy).
- `vuong-lam-dark.webp`: đảo mức xám (mực đen thành khói sáng), giữ lại gương mặt sáng bằng mặt nạ elip mềm; hiển thị với `mix-blend-mode: screen` nên nền đen biến mất trên theme tối (`slate`).
Cách tái tạo: xem các bước trên, dùng Pillow (mức sáng 0–232 kéo lên 0–255 cho bản sáng).

## Bản quyền (người dùng tự quyết)
Ảnh Vương Lâm do người dùng cung cấp, nguồn gốc và quyền sử dụng chưa rõ (hình nhân vật từ truyện/phim Tiên Nghịch). Ứng dụng này là bản dùng riêng một người; nếu đưa cho người khác dùng thì cần xác minh bản quyền hoặc thay ảnh (chỉ cần thay hai file WebP cùng tên). Nhân vật pixel là tranh vẽ riêng của dự án.

## Kiểm thử
`e2e/tests/ambience.spec.js` (6 test):
1. Nhân vật ở lề trái, không chạm thẻ chữ, cao <= 62% màn hình, rộng <= 365px; theme trắng dùng bản light, theme tối dùng bản dark; không tràn ngang; không lỗi console.
2. Chuột vào đoạn chữ: canvas hiện ở lề phải (không chạm thẻ chữ, nằm gần chiều cao chuột), có hình vẽ thật (đếm điểm ảnh), tự về trạng thái nghỉ sau vài giây, đoạn khác thì có trận mới; không có request API nào do hover gây ra.
3. Dưới 1100px: không nhân vật, canvas ẩn, chuột chỉ vào chữ không bắt đầu trận.
4. Công tắc: tắt thì mất cả nhân vật lẫn canvas, hover không có trận, lưu `ambience: false` vào cài đặt.
5. Giảm chuyển động: nhân vật hiện, canvas không chạy.
6. Điện thoại 375px: mặc định không dải ảnh/pixel; bật công tắc thì có dải ảnh trong màn hình (cao <= 220px), vẫn không có nhân vật bên lề, không tràn ngang.

Dáng vẻ pixel-art và độ hài hòa của ảnh được đánh giá bằng ảnh chụp màn hình (sáng, sepia, tối, điện thoại, các khung hình trận đánh), không bằng test tự động.
