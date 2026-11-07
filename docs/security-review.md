# Rà soát bảo mật cuối (2026-11-07)

## Đã kiểm tra, đạt
| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| Phiên đăng nhập | Cookie `__Host-session` HttpOnly, Secure, SameSite=Strict; không có token trong localStorage | E2E `reader.spec.js` (cookie HttpOnly, xóa token cũ) |
| CSRF | Ghi dữ liệu bắt buộc Origin cùng site; prod trả 403 khi thiếu Origin | test `cookie.test.js`, kiểm tra prod |
| CORS | Không bật CORS; preflight từ origin lạ không nhận được `Access-Control-Allow-*` | kiểm tra prod |
| Quyền sở hữu | Mọi endpoint sách (file, xóa, tiến độ, dấu trang, chương, lô chương, danh sách chương đã tách) kiểm tra chủ sách | `ownership.test.js`, `extract.test.js`; kiểm đột biến bỏ kiểm tra thì test đỏ |
| Thu hồi phiên | Đăng xuất mọi thiết bị vô hiệu token cũ (token_version) | `auth.test.js`, E2E |
| Chống dò mật khẩu | 5 lần sai/người+IP và 30 lần/IP trong 15 phút; mật khẩu tối thiểu 12 ký tự; PBKDF2 100.000 vòng, tự nâng cấp hash cũ | `auth.test.js` |
| Đăng ký | Đóng trên prod | kiểm tra prod |
| Header | HSTS, CSP chặt (không còn Google Fonts), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy; API trả `Cache-Control: no-store` | `curl` prod |
| CSP | Không lỗi console CSP trong luồng chính | E2E `collectProblems` |
| HTML từ trình duyệt | Máy chủ luôn lọc lại (`cleanXhtml`), không tin lô chương | `extract.test.js`; kiểm đột biến |
| Phụ thuộc | `npm audit`: 0 lỗ hổng ở cloudflare_worker, reader_frontend, e2e | chạy 2026-11-07 |
| Bí mật trong git | Không còn khóa thật trong lịch sử; chỉ còn giá trị giả dùng cho test | quét `git log -p`; lịch sử đã viết lại trước đó |
| Offline | Cache dữ liệu cá nhân xóa khi đăng xuất; không lưu `user: null` | E2E `offline.spec.js`; kiểm đột biến |

## Rủi ro còn lại (chấp nhận được cho dùng cá nhân)
- Thiết bị đang offline vẫn đọc được bản đã lưu sau khi "đăng xuất mọi thiết bị" ở máy khác, tới khi có mạng.
- `style-src` còn `'unsafe-inline'` (React đặt style trực tiếp). Rủi ro thấp vì `script-src 'self'`.
- Giới hạn tốc độ đăng nhập dựa vào D1, không phải tường lửa; nên bật thêm Cloudflare WAF/Rate Limiting nếu mở đăng ký.
- JWT_SECRET là một bí mật duy nhất; đổi nó sẽ đăng xuất tất cả (dùng khi nghi ngờ lộ).

## Việc của chủ dự án (không làm hộ được)
- Thu hồi khóa Gemini cũ nếu chưa làm.
- Đăng xuất khỏi trang truyện đã cào.
- Đổi mật khẩu hai tài khoản local cũ nếu trùng mật khẩu thật.
- Kiểm tra GitHub Pages đã tắt.
- Xóa file `%TEMP%\bk\cuu-u-reader-before-rewrite.bundle`.
