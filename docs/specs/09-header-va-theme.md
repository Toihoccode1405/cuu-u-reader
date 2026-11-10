# Spec 09 - Thanh đầu và theme theo trang mẫu

Thay thế phần header của spec 07 (cách ẩn/hiện khi cuộn trên điện thoại vẫn giữ).

## Thanh đầu
- Cao 56px mọi cỡ màn hình, nền theme 95% mờ có làm nhòe phía sau, viền dưới; nội dung tối đa 1172px.
- Bốn nút: quay lại thư viện | tên truyện (một dòng, cắt bớt) | mục lục (biểu tượng + "Chương n" từ máy tính bảng) | Aa (cài đặt) | ⋯.
- Menu ⋯ chứa mọi chức năng còn lại, ở cả máy tính: ghim sáng dòng, cắm cờ, danh sách cờ, phím tắt, tải EPUB, sửa chương, toàn màn hình. Phím tắt giữ nguyên.
- Thanh tiến độ 2px màu nhấn ở đáy thanh, dài theo vị trí cuộn. Chương trước/sau nằm ở thanh nút nổi (spec 08), không còn trên header.

## Theme (4 lựa chọn, ô tròn màu kèm tên)
| Theme | Thẻ | Nền trang | Chữ | Chữ phụ | Viền | Màu nhấn |
|---|---|---|---|---|---|---|
| Sáng | #ffffff | #f5f5f4 | #18181b | #71717a | #e7e5e4 | #c94119 |
| Sepia | #f4ecd8 | #ece2c8 | #433422 | #705e46 | #ded0b4 | #b53714 |
| Tối | #161618 | #0b0b0c | #f4f4f5 | #a1a1aa | #27272a | #ff6b47 |
| Theo giao diện | Sáng hoặc Tối theo hệ điều hành, đổi ngay khi hệ điều hành đổi (mặc định cho người mới) |

- Sáng/Sepia/Tối lấy từ số đo thật của trang mẫu; nền trang của Sáng và Sepia do dự án chọn (trang mẫu chỉ đổi màu thẻ).
- Sáu theme cũ bị bỏ. Cài đặt đã lưu được chuyển: Huyền Thiết và U Minh thành Tối; Bạch Ngọc, Thanh Liên, Mặc Họa thành Sáng; Hoàng Ngọc thành Sepia.

## Kiểm thử (seam S5)
`e2e/tests/header.spec.js` (3 cỡ: 4 nút, tên truyện, tiến độ, menu đủ 7 mục) và `e2e/tests/themes.spec.js` (đúng màu từng theme, theme cũ được chuyển, "Theo giao diện" theo hệ điều hành). Đã kiểm đột biến: ép "Theo giao diện" luôn Sáng làm test đỏ.
