# 0002 - Chương tách sẵn lưu trong D1, vẫn giữ EPUB gốc

## Quyết định
Trình duyệt tách chương và gửi lên; Worker lọc rồi lưu từng chương vào bảng `chapters` của D1. File EPUB gốc vẫn được giữ (trong `book_chunks`).

## Vì sao
- Đọc chương chỉ là một truy vấn D1 thay vì giải nén EPUB lớn trên Worker (giới hạn CPU).
- Giữ EPUB gốc để tải về, để tách bù cho sách cũ và để tách lại nếu quy tắc cắt chương thay đổi.
- Không dùng R2 (người dùng không muốn).

## Đánh đổi
- Dung lượng D1 tăng thêm khoảng bằng phần chữ của sách (chấp nhận được với một người dùng).
- Worker không tin HTML từ trình duyệt: luôn lọc lại phía server.
- Chương đã có không bị ghi đè (an toàn cho chương tự sửa, đổi lại muốn tách lại phải xóa chương trước).
