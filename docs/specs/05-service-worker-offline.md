# Spec 05 - Service Worker offline

## Mục tiêu
Mở nhanh lần sau và đọc được khi mất mạng (tàu, thang máy...).

## Hành vi
- **Vỏ ứng dụng** (trang chính, `/assets/*`, icon): lưu lại, dùng bản đã lưu khi mất mạng.
- **Dữ liệu đọc** (thông tin phiên, danh sách sách, chi tiết sách, chương, bìa, dấu trang, lịch sử, cài đặt): mạng trước, mất mạng dùng bản đã lưu. Chỉ các GET này được lưu; đăng nhập, ghi, tải file EPUB gốc luôn đi qua mạng.
- `/api/auth/me` chỉ được lưu khi đã đăng nhập (không lưu `user: null`), nên mất mạng không "đăng nhập giả".
- **Đăng xuất xóa sạch** cache dữ liệu (`cuu-data-v1`). Sau đó mất mạng cũng chỉ thấy trang đăng nhập.
- Chương chưa từng mở thì offline không đọc được (không tải trước cả sách).

## Giới hạn đã biết
- "Đăng xuất mọi thiết bị" làm thiết bị khác mất phiên khi online; thiết bị đang offline vẫn đọc được bản đã lưu tới khi có mạng lại hoặc tự đăng xuất.
- Dữ liệu offline nằm trên máy, xóa khi đăng xuất hoặc xóa dữ liệu trang.

## Kiểm thử
`e2e/tests/offline.spec.js`: (1) đọc sách online rồi tắt mạng, tải lại vẫn thấy thư các và đọc lại chương; (2) đăng xuất xóa hết `/api/*` trong cache và tắt mạng không vào được thư các. Đã kiểm đột biến: bỏ lệnh xóa cache thì test 2 đỏ.
