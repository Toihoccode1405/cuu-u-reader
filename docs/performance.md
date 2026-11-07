# Hiệu năng

Mục tiêu: mở chương lần đầu < 1.5s, chương đã tách < 300ms, trang đầu < 2s trên 4G.

## Cách đo
`cd e2e && PERF=1 npx playwright test perf` (cần `cd reader_frontend && npm run build` trước). Dùng Worker cục bộ với sách giả 200 chương, khoảng 7MB.

## Kết quả (Worker cục bộ, 2026-11-07)
| Phép đo | Thời gian |
|---|---|
| Mở chương lần đầu (máy chủ tự tách) | 105-213 ms |
| Chương đã tách sẵn (D1) | 17-19 ms |

Đạt cả hai mục tiêu với biên rất rộng. Đây là số đo cục bộ: không có độ trễ mạng và không bị giới hạn CPU của Worker, nên số trên prod sẽ cao hơn. Chưa đo trên prod vì cần tài khoản thật (đăng ký đã đóng); nên tự đo bằng DevTools (Network) với một sách lớn thật.

## Các cải thiện đã làm (theo thứ tự)
- Chương đã tách đọc thẳng từ D1, không giải nén EPUB (P3).
- Sách mới tách chương ngay khi tải lên, sách cũ tách bù ở nền (P3).
- Font tự host, không kết nối ngoài, cache immutable một năm; chỉ tải subset latin/vietnamese cần dùng (P4).
- Service Worker: vỏ ứng dụng và chương đã đọc mở lại không cần mạng (P5).
- Trang chính 605 B, JS chính khoảng 89 kB nén; jszip chỉ tải khi cần.

## Chưa làm / có thể làm sau
- Đo Lighthouse trên prod (LCP, INP) bằng điện thoại thật.
- Tải trước chương kế khi đang đọc.
