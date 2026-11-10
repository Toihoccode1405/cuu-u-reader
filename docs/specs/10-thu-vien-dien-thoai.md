# 10 – Thư viện trên điện thoại (header gọn, thẻ sách không bẻ dòng)

## Vấn đề
Ở màn hẹp (~400px) trang Thư viện bị vỡ: tên "Cửu U Thư Các" bẻ 3 dòng, ô tìm kiếm co thành hình tròn, chip tu vi + huy hiệu tài khoản + nút Thêm sách tràn ra mép phải; nút "Đọc tiếp" và dòng tác giả trong thẻ lịch sử bị bẻ dòng. Ở 320px cột lưới lịch sử (`minmax(320px, …)`) còn rộng hơn màn hình nên cả trang cuộn ngang.

## Quyết định (đã chốt với người dùng)
| Khoảng | Hành vi |
|---|---|
| Điện thoại ≤640px | Header một hàng ≤64px. Logo chỉ còn con dấu. Tìm kiếm là nút kính lúp, bấm ra ô nhập chiếm cả hàng (có nút đóng). Chip tu vi chỉ còn biểu tượng + "tầng N" (tên cảnh giới nằm trong tooltip và bảng cảnh giới). "Thêm sách" chỉ là dấu "+". Tài khoản gộp một nút mở menu: tên tài khoản, "Đăng xuất", "Đăng xuất mọi thiết bị" (đóng bằng Esc hoặc bấm ra ngoài). |
| Máy tính bảng 641–1024px | Giữ bố cục cũ, chỉ thu gọn khoảng cách; không tràn ngang; logo không bẻ dòng. |
| Thẻ sách/lịch sử (mọi cỡ) | "Đọc tiếp" luôn một dòng; dòng tác giả • % cắt bằng "…"; lưới lịch sử dùng `minmax(min(320px,100%),1fr)`. |

## Phạm vi và bảo mật
Chỉ đổi giao diện (JSX + CSS), không thêm endpoint, không đổi dữ liệu. Đăng xuất vẫn gọi đúng `handleLogout` / `handleLogoutAll` như trước.

## Kiểm thử (E2E `e2e/tests/library-phone.spec.js`, 320/375/400/768/1280px)
- Không tràn ngang; header ≤64px trên điện thoại; logo không bẻ dòng, chỉ con dấu trên điện thoại.
- Mọi nút trong header nằm trong màn hình; chip tu vi, nút thêm sách hiển thị.
- Điện thoại: kính lúp mở/đóng ô tìm kiếm full hàng; menu tài khoản có "Đăng xuất" và "Đăng xuất mọi thiết bị", không tràn mép; Esc đóng.
- Máy lớn: ô tìm kiếm luôn hiện, không có nút "Tài khoản" gộp.
- "Đọc tiếp" ≤40px cao (một dòng); dòng tác giả ≤22px.
- Kiểm tra đột biến: bỏ khối CSS thẻ lịch sử → 5/5 test đỏ.
