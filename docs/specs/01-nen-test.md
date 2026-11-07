# 01 - Nền test

## Mục tiêu
Có bộ test tự động chứng minh các hành vi quan trọng của Cửu U Thư Các, để các phần tối ưu sau (cookie, tách chương, offline) đổi bên trong mà không làm hỏng người dùng.

## Phạm vi (các seam đã chốt)
| Seam | Công cụ | Nội dung |
|---|---|---|
| S1 API: đăng nhập và phiên | Vitest + `@cloudflare/vitest-plugin` | đăng ký, đăng nhập, giới hạn thử sai, mật khẩu kiểu cũ, `me`, đăng xuất mọi thiết bị, cấu hình máy chủ |
| S2 API: quyền sở hữu sách | Vitest | người B không đọc, sửa, xóa, đánh dấu được sách của A ở mọi endpoint |
| S3 API: sách và chương | Vitest | upload EPUB, đọc chương, tiến độ, dấu trang, xóa, cài đặt, sửa chương và lọc XSS |
| S4 API: CORS và header | Vitest | origin lạ bị từ chối, `no-store`, không lộ lỗi nội bộ |
| S5 Luồng người dùng | Playwright (Chrome cài sẵn) | đăng ký, đưa sách lên, đọc, sang chương, đăng xuất, không có lỗi console/CSP |

Không test: hàm nội bộ (`cleanXhtml`, đọc EPUB, băm mật khẩu), component riêng lẻ, Service Worker (phần 5), header của trang tĩnh (kiểm tra trên bản deploy ở bước Verify).

## Cách chạy
```bash
cd cloudflare_worker && npm test        # API (55 test)
cd reader_frontend && npm run build     # E2E dùng bản build
cd e2e && npx playwright test           # luồng người dùng (5 test)
```
E2E tự chạy `wrangler dev` cục bộ với D1 tạm trong `e2e/.state`, không đụng dữ liệu thật.

## Tiêu chí đạt
- 55 test API và 5 test E2E đều xanh.
- Mỗi nhóm bảo vệ quan trọng đã được kiểm chứng "có thể đỏ" bằng cách cố ý làm hỏng code (bỏ kiểm tra chủ sở hữu, CORS mở, bỏ lọc HTML, nới giới hạn thử sai, bỏ kiểm tra phiên): cả 5 lần test đều đỏ.
- `npm audit` sạch ở `cloudflare_worker` và `e2e`.

## Phát hiện trong lúc làm
- Trang thiếu `<link rel="icon">` nên trình duyệt xin `/favicon.ico` và nhận 404 trong console. Đã thêm liên kết tới `favicon.svg`.
