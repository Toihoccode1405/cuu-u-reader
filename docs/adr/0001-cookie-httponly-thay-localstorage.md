# 0001 - Phiên đăng nhập bằng cookie HttpOnly thay vì localStorage

**Trạng thái:** chấp nhận (2026-11-07)

## Bối cảnh
Token đăng nhập trước đây nằm trong `localStorage` và được gửi bằng header `Authorization`. Bất kỳ đoạn JavaScript nào chạy trên trang (ví dụ qua một lỗ hổng XSS) đều đọc được token và dùng ở nơi khác trong tối đa 30 ngày. Giao diện và API đã cùng một origin (Worker phục vụ cả hai).

## Quyết định
Dùng cookie `__Host-session` (HttpOnly, Secure, SameSite=Strict). Chống CSRF bằng SameSite kết hợp bắt buộc header `Origin` trùng origin của site với mọi yêu cầu ghi. Bỏ hẳn header `Authorization` và token trên URL. Giữ `token_version` để thu hồi phiên.

## Các lựa chọn đã xét
- **Giữ localStorage** (đơn giản, chạy được với `vite dev`): không chặn được việc đánh cắp token qua XSS. Loại.
- **Token ngắn hạn + refresh token**: phức tạp hơn nhiều cho một người dùng. Loại.
- **Cookie HttpOnly** (chọn): JavaScript không đọc được; đổi lại phải xử lý CSRF và mất `vite dev` riêng.

## Hệ quả
- Phải chạy thử cục bộ bằng `wrangler dev` với bản build; không dùng `vite dev`.
- Không thể gọi API từ origin khác (không còn CORS). Nếu sau này tách giao diện sang tên miền khác thì phải xem lại quyết định này.
- Mọi phiên cũ hết hiệu lực khi triển khai.
- Dịch vụ offline (Service Worker) phải xóa cache dữ liệu khi đăng xuất, vì cookie không còn là chỗ duy nhất mang danh tính.
