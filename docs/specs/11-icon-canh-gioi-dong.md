# 11 – Icon cảnh giới động (SVG riêng của dự án)

## Nguồn và ánh xạ
Bộ 17 icon trong `docs/brand/realms_full.html` (do người dùng thiết kế) thay bộ game-icons cũ. `reader_frontend/scripts/gen-realm-icons.mjs` đọc file đó và sinh `src/realmIconData.js` (khung 100x100, màu ánh sáng riêng).

18 bậc của ứng dụng dùng 16 icon đầu (Đạp Thiên Cảnh, id 17, chưa có trong hệ tu vi nên chưa dùng). Hai nhóm dùng chung một hình trong file nguồn được tách bằng biến thể nhỏ để mỗi bậc một hình riêng (test cũ yêu cầu 18 hình khác nhau):
- Âm Hư: nửa lam sáng, nửa đỏ mờ. Dương Thực: ngược lại.
- Huyền Kiếp: hình của Không Huyền thêm một vòng nét đứt xoay.

## Hoạt ảnh (giữ nguyên như file nguồn)
- `realm-breathe` 3,5s: phóng 1→1,06 và quầng sáng `drop-shadow(currentColor)` đổi cường độ.
- `realm-spin` 24s: vòng nét đứt quay tuyến tính. Khác file nguồn một điểm: đặt `transform-origin` tại tâm (50,50), vì nếu không SVG quay quanh góc trên-trái làm vòng trôi lệch khỏi tâm.
- `prefers-reduced-motion: reduce` tắt cả hai.

## Bảo mật / hiệu năng
SVG sinh lúc build từ file của dự án, không có script, không tải tài nguyên ngoài (CSP không đổi). Bỏ phụ thuộc dev `@iconify-json/game-icons` và dòng ghi công game-icons.

## Kiểm thử
`e2e/tests/realm-icons.spec.js`: viewBox 100, đúng animation, màu từ bộ mới, tâm vòng xoay không trôi (đột biến bỏ `transform-origin` → đỏ), 18 hình khác nhau, không có yêu cầu mạng ngoài, tắt hoạt ảnh khi giảm chuyển động.
