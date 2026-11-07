# 02 - Phiên đăng nhập bằng cookie HttpOnly

## Mục tiêu
Token đăng nhập không còn nằm trong `localStorage`, nên một lỗ hổng XSS (nếu có) không lấy được phiên của người đọc. Xem [ADR 0001](../adr/0001-cookie-httponly-thay-localstorage.md).

## Hành vi
- **Đăng ký / đăng nhập** thành công: máy chủ đặt cookie `__Host-session` với `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000` (30 ngày), không có `Domain`. Thân phản hồi chỉ có thông tin người đọc, **không có token**.
- **Mọi API dữ liệu** chỉ nhận phiên qua cookie. Không nhận header `Authorization` và không nhận `?token=` trên URL.
- **Mở trang**: giao diện gọi `GET /api/auth/me`. Còn phiên thì trả `{user}`, không có phiên thì trả `200 {user: null}` (không sinh lỗi 401 trong console).
- **Đăng xuất** (`POST /api/auth/logout`): xóa cookie ở thiết bị này; thiết bị khác vẫn đăng nhập.
- **Đăng xuất mọi thiết bị** (`POST /api/auth/logout-all`): tăng `token_version` (mọi token đã cấp mất hiệu lực) và xóa cookie ở thiết bị này.
- **Chống CSRF**: mọi yêu cầu **ghi** (khác GET, HEAD, OPTIONS) bắt buộc có header `Origin` trùng origin của site, nếu không trả 403. Áp dụng cả với đăng nhập và đăng ký.
- **CORS**: không cấp cho bất kỳ origin nào. Giao diện và API luôn cùng origin.
- **Mật khẩu tài khoản mới** tối thiểu 12 ký tự (đăng nhập vẫn nhận mật khẩu cũ ngắn hơn).
- Ảnh bìa tải bằng thẻ `<img>` thường (trình duyệt tự gửi cookie).

## Thay đổi cách làm việc cục bộ
Không dùng `vite dev` (cổng khác, cookie không đi chung origin). Build giao diện rồi chạy `wrangler dev`:
```bash
cd reader_frontend && npm run build
cd ../cloudflare_worker && npx wrangler dev --var JWT_SECRET:<chuỗi dài 32+ ký tự> --var ALLOW_REGISTRATION:true
```

## Ảnh hưởng
Mọi phiên cũ mất hiệu lực một lần: người đọc đăng nhập lại.

## Tiêu chí đạt (đã kiểm chứng)
- 55 test API và 5 test E2E đều xanh.
- 5 lần cố ý làm hỏng code (thiếu HttpOnly, bỏ kiểm tra Origin, SameSite=Lax, mật khẩu tối thiểu 8, trả token trong thân phản hồi) đều làm test đỏ.
- E2E xác nhận: cookie có `httpOnly`, `secure`, `sameSite=Strict`; `document.cookie`, `localStorage`, `sessionStorage` không chứa token; tải lại trang vẫn đăng nhập; đăng xuất mọi thiết bị làm thiết bị kia về trang đăng nhập.

## Dọn dẹp kèm theo
Xóa mã không dùng: `AuthImage.jsx` (tạm có ở phần trước), `CloudModal.jsx`, `AuthModal.jsx` (không được import ở đâu, còn giữ hợp đồng token cũ).
