# Spec 06 - Tu vi và cảnh giới

## Ý tưởng
Đọc truyện thì tích **tu vi**; tu vi quyết định **cảnh giới** (18 bậc theo Tiên Nghịch, chia ba **Bước**). Mục tiêu: có cảm giác tiến bộ khi đọc, không gây áp lực.

## Luật
- Tu vi = tổng số từ đã đọc. Một người đọc có một tu vi chung cho mọi sách; xóa sách không làm mất tu vi.
- Đọc lại vẫn cộng. Chống lướt bằng tốc độ, không bằng "mỗi chương một lần".
- Máy chủ tự đếm từ từ nội dung chương nó lưu; trình duyệt chỉ báo khoảng đoạn và số giây.
  - Tối đa 1200 từ/phút (20 từ/giây) theo số giây khai.
  - Số giây bị chặn bởi thời gian thật trôi qua từ lần báo trước, và tối đa 120 giây mỗi lần.
  - Lần báo đầu tiên được tính tối đa 120 giây.
- Đoạn = khối `<p>` có từ 2 ký tự trở lên (cùng quy tắc đánh số `data-p` của giao diện). Đoạn ngoài phạm vi bị bỏ qua.
- Tu vi tối đa 6.145.000 (hết tầng cuối của Không Kiếp).
- Cảnh giới và tầng suy ra từ tu vi; mỗi cảnh giới chia đều theo tầng (9 tầng, riêng Thiên Nhân Suy Kiếp 5 tầng). Bảng mốc ở `shared/cultivation.js`, một hệ số chỉnh được ở một nơi.
- Đột phá = lên tầng hoặc cảnh giới mới sau một lần báo.
- Công tắc: tắt chỉ ẩn giao diện, máy chủ vẫn ghi, bật lại không mất gì.
- Cộng hồi tố một lần duy nhất: các chương đứng trước chương đang đọc của mọi sách.

## Mốc cảnh giới (từ)
| Bước | Cảnh giới | Mốc |
|---|---|---|
| 1 | Ngưng Khí / Trúc Cơ / Kết Đan / Nguyên Anh / Hóa Thần / Anh Biến / Vấn Đỉnh | 0 / 15k / 50k / 110k / 210k / 360k / 570k |
| 1 | Âm Hư, Dương Thực (quá độ) | 850k / 1,2tr |
| 2 | Khuy Niết / Tịnh Niết / Toái Niết | 1,61tr / 2,06tr / 2,535tr |
| 2 | Thiên Nhân Suy Kiếp (5 tầng, quá độ) | 3,025tr |
| 3 | Không Niết / Không Linh / Không Huyền / Huyền Kiếp / Không Kiếp | 3,525tr / 4,035tr / 4,555tr / 5,08tr / 5,61tr |

Với 2 giờ đọc mỗi ngày (~13 triệu từ/năm) thì đầy trong khoảng 5-6 tháng.

## API
- `GET /api/cultivation` -> `{ tu_vi, enabled, realm: { name, alias, buoc, buoc_name, qua_do, tang, tangs, progress, max } }`
- `PUT /api/cultivation` `{ enabled: boolean }`
- `POST /api/reading/report` `{ book_id, chapter_index, from_para, to_para, seconds }` -> `{ gained, tu_vi, realm, breakthrough }`
- `POST /api/cultivation/backfill` -> `{ gained, tu_vi, enabled, realm }` (lần sau gained = 0)
- Mọi endpoint cần cookie phiên; ghi cần Origin hợp lệ; sách phải thuộc người đọc (404).

## Kiểm thử
`cloudflare_worker/test/cultivation.test.js` (seam S6, S6b, S6c; dùng đồng hồ giả). Đã kiểm đột biến: bỏ trần tốc độ, bỏ ràng buộc thời gian thật, bỏ kiểm tra sở hữu, cho phép cộng hồi tố nhiều lần, lệch số tầng đều làm test đỏ.

## Giao diện (phần sau, seam S5)
Thanh tu vi trong thư các, thông báo "Đột phá!", công tắc ẩn/hiện, gom báo cáo khi offline rồi gửi lại.
