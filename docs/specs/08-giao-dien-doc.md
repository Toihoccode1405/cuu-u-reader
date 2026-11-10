# Spec 08 - Giao diện đọc kiểu thẻ

Tham khảo bố cục của một trang đọc truyện khác (chỉ lấy cách bố trí và số đo; không dùng chữ, hình hay thương hiệu của họ). Header của dự án giữ nguyên (spec 07).

## Luật
- **Thẻ đọc**: từ 641px trở lên là thẻ bo góc 16px, viền mảnh, màu `--bg-surface` trên nền `--bg-primary`, rộng tối đa 760px, đệm 3,5rem (tablet 3rem). Điện thoại: thẻ tràn màn hình, không viền, đệm 2rem 1.25rem.
- **Đầu chương**: dòng nhỏ "CHƯƠNG n" (12px, đậm, giãn chữ 0.25em), tiêu đề serif (Literata 600; 2,1em, điện thoại 1,75em), vạch kẻ hai nhánh có hình thoi ở giữa, dòng mờ tên truyện. Tên chương dạng "Chương n: Tên" được tách; tên không theo mẫu thì giữ nguyên và lấy số thứ tự chương.
- **Drop cap**: chữ cái đầu của đoạn 0 to 3,4em, Literata 600, nổi trái, màu nhấn.
- **Chữ**: mặc định Literata 20px, giãn dòng 1,8, thẻ 760px. Người dùng cũ được chuyển sang mặc định này một lần (cờ `uiv: 2` trong cài đặt), sau đó tự chỉnh thoải mái.
- **Màu nhấn** `--reader-accent`: lấy `--accent-color` của chủ đề; hai chủ đề tối (Huyền Thiết, U Minh) dùng cam `#ff6b47`.
- **Thanh nút nổi** (luôn hiện, cách đáy 16px, giữa màn hình): Chương trước | mục lục "n / tổng" | Aa (cài đặt) | Chương sau (nút nhấn màu). Nhãn chữ "Chương trước/sau" ẩn trên điện thoại, chỉ còn mũi tên. Thay thế thanh chương trước/sau và chân trang cũ cuối bài.
- **Tấm cài đặt**: điện thoại trượt từ dưới lên (tối đa 70% chiều cao, có thanh kéo); màn lớn vẫn là ngăn kéo bên phải. Mọi tùy chọn giữ nguyên.
- Mở chương ở đoạn 0 thì không tự cuộn (để thấy đầu chương); đọc dở ở đoạn khác vẫn cuộn về đó.

## Kiểm thử (seam S5)
`e2e/tests/reading-surface.spec.js` ở 3 cỡ màn hình: đầu chương, drop cap, khung thẻ, cỡ chữ/giãn dòng, thanh nổi (vị trí, mở mục lục, mở cài đặt, sang chương sau và trạng thái nút), tấm trượt trên điện thoại. Kiểm đột biến: tắt `float` của drop cap làm test đỏ.

## Cập nhật (giãn dòng và tiến độ)
- Thanh "Giãn dòng" chỉnh **khoảng cách giữa các đoạn** (gap = giá trị - 1,05 em; mặc định 1,8 cho 0,75em như cũ). Dòng trong một đoạn cố định 1,8 và không đổi theo thanh trượt.
- Thanh tiến độ ở đáy header cập nhật trực tiếp vào DOM khi cuộn, đổi kích thước trang (phông/hình tải xong) và sang chương, nên không đứng yên ở giá trị cũ. Ẩn cùng header. Test: giãn dòng, tiến độ chạy theo cuộn và theo đổi chiều cao trang.
- Nguyên nhân thanh tiến độ "treo" trên truyện nghìn chương: mỗi lần cuộn đều cập nhật state làm dựng lại cả App, kể cả danh sách mục lục hàng nghìn chương luôn được dựng sẵn. Đã bỏ state theo cuộn và chỉ dựng mục lục khi mở. Test: mục lục không có phần tử khi đóng.
