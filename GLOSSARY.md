# Cửu U Thư Các

Trình đọc tiểu thuyết cá nhân: người đọc đưa sách EPUB của mình lên thư viện riêng, đọc ở mọi thiết bị và được ghi nhớ vị trí đang đọc.

## Language

**Người đọc**:
Chủ của một tài khoản; chỉ thấy và sửa được sách của chính mình.
_Avoid_: User, khách, thành viên

**Thư Các**:
Tập hợp các sách của một người đọc.
_Avoid_: Library, kệ sách, kho truyện

**Sách**:
Một cuốn tiểu thuyết do người đọc đưa lên từ file EPUB, gồm tiêu đề, tác giả, ảnh bìa và danh sách chương.
_Avoid_: Truyện, book, file

**Chương**:
Một phần nội dung của sách, mở đọc theo số thứ tự.
_Avoid_: Chapter, hồi, tập

**Tách chương**:
Bước lấy nội dung của từng chương ra khỏi file EPUB thành văn bản đọc được, làm một lần ngay khi đưa sách lên.
_Avoid_: Parse, extract, cache chương

**Chương đã tách**:
Chương đã có sẵn văn bản đọc được nên mở ngay, không phải xử lý lại file EPUB.
_Avoid_: Chương đã cache

**Tách bù**:
Tách chương cho một cuốn sách đã đưa lên từ trước khi có bước Tách chương.
_Avoid_: Migration, backfill

**Tiến độ đọc**:
Vị trí người đọc dừng lại trong một sách: chương, đoạn và phần trăm cuộn.
_Avoid_: Progress, bookmark tự động

**Dấu trang**:
Cờ do người đọc tự đặt tại một đoạn của một chương để quay lại sau.
_Avoid_: Bookmark, cờ đánh dấu

**Phiên đăng nhập**:
Khoảng thời gian một thiết bị được nhận là của người đọc sau khi đăng nhập; có thể bị thu hồi.
_Avoid_: Session, token, đăng nhập
