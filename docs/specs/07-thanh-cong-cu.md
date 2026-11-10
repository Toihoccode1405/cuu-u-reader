# Spec 07 - Thanh công cụ khi đọc

## Vấn đề
Trên điện thoại thanh công cụ cao 52px, có 7 nút, tên chương bị ép, và chỉ cần vuốt ngược một chút là thanh hiện lại che chữ.

## Luật theo cỡ màn hình
| Cỡ | Cao | Nút trên thanh | Trong menu ⋯ |
|---|---|---|---|
| Điện thoại (≤640px) | 44px | Quay lại, tên chương, Cắm cờ, Mục lục, Cài đặt, ⋯ | Ghim sáng, Danh sách cờ, Tải EPUB, Sửa chương (nút chương trước/sau vẫn ẩn trên điện thoại như trước) |
| Máy tính bảng (641-1024px) | 52px | Như điện thoại, thêm Chương trước/sau | Ghim sáng, Danh sách cờ, Tải EPUB, Sửa chương, Toàn màn hình |
| Máy tính (≥1025px) | 56px | Tất cả, chia nhóm bằng vạch mảnh | Không có |

- Thanh cao thêm vùng an toàn phía trên (tai thỏ). Thanh tiến độ và phần đầu nội dung dùng cùng biến `--reader-header-height`.
- Tên chương co giãn chiếm phần còn lại. Không tràn ngang ở cả 3 cỡ.
- Menu ⋯ đóng khi bấm ra ngoài, nhấn Esc, chọn một mục, hoặc khi thanh bị ẩn. Mục có `role=menuitem`, cao tối thiểu 44px.

## Ẩn/hiện trên điện thoại
- Cuộn xuống (quá 60px) thì ẩn.
- Cuộn ngược chỉ hiện lại khi tổng quãng cuộn ngược liên tục đạt 150px, hoặc về gần đầu chương. Vuốt ngược ngắn không làm hiện.
- Khi thanh ẩn có nút nhỏ "Hiện thanh công cụ" ở giữa mép trên.
- Sau khi mở chương, 2,5 giây đầu bỏ qua việc ẩn theo cuộn, vì lúc đó trang tự cuộn về chỗ đọc dở.
- Máy tính bảng và máy tính giữ hành vi cũ (cuộn ngược quá 25px là hiện).

## Kiểm thử (seam S5)
`e2e/tests/header.spec.js`: 3 cỡ màn hình (không tràn ngang, chiều cao, nút chính hiện, tên chương còn thấy, mọi nút trong màn hình, menu ⋯ mở được và bấm mục thì mở bảng tương ứng) và kịch bản cuộn trên điện thoại. Đã kiểm đột biến: hạ ngưỡng 150px xuống 10px làm test đỏ.
