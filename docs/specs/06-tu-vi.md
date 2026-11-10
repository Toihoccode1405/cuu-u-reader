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
- Cộng hồi tố một lần duy nhất: các chương đứng trước chương đang đọc của mọi sách. Chương đã tách thì đếm thật; chương chưa tách chỉ tách thêm tối đa 40 chương mỗi lần, phần còn lại ước lượng theo số từ trung bình của sách đó (đo cho thấy tách 299 chương trong một lần mất ~19 giây, quá rủi ro trên Worker).

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
- `POST /api/reading/report` `{ book_id, chapter_index, from_para, to_para, seconds, at? }` -> `{ gained, tu_vi, realm, breakthrough }`
- `POST /api/cultivation/backfill` -> `{ gained, tu_vi, enabled, realm }` (lần sau gained = 0)
- Mọi endpoint cần cookie phiên; ghi cần Origin hợp lệ; sách phải thuộc người đọc (404).

## Kiểm thử
`cloudflare_worker/test/cultivation.test.js` (seam S6, S6b, S6c; dùng đồng hồ giả). Đã kiểm đột biến: bỏ trần tốc độ, bỏ ràng buộc thời gian thật, bỏ kiểm tra sở hữu, cho phép cộng hồi tố nhiều lần, lệch số tầng đều làm test đỏ.

## Giao diện
- Thư các: chip "Cảnh giới · tầng N" kèm thanh tiến độ tầng; di chuột xem Bước và tu vi. Bấm công tắc "Hệ thống tu tiên" trong cài đặt khi đọc để ẩn/hiện.
- Khi đọc: mỗi giây ghi nhận các đoạn đang hiện trên màn hình (chỉ khi trang đang hiển thị). Chỉ đoạn **mới** hiện ra trong lần mở chương này mới được báo, nên ngồi yên trên một màn hình không bị cộng lặp. Một đoạn chỉ được báo khi thời gian đã đọc đủ cho số từ của nó ở tốc độ tối đa (20 từ/giây); kiểm tra mỗi 10 giây, và khi đổi chương hoặc ẩn trang thì báo nốt phần đã đủ thời gian.
- Sự cố đã sửa (2026-11-10): bản đầu báo lại toàn bộ đoạn đang hiện trên màn hình mỗi 10 giây nên đọc 5-10 phút bị tính ở mức trần 1200 từ/phút (lên Ngưng Khí tầng 5). Test E2E "ngồi yên" bảo vệ lỗi này (trước khi sửa: 799 tu vi cho đoạn 300 từ trong 40 giây).
- Đọc lại chương ở lần mở khác vẫn được cộng; trong cùng một lần mở chương, đoạn đã báo không được báo lại.
- Lên tầng hoặc cảnh giới: hiện "Đột phá!" 5 giây (chỉ khi hệ thống đang bật).
- Mất mạng: báo cáo xếp vào hàng đợi trong localStorage (tối đa 200), gửi bù theo thứ tự khi có mạng. Mỗi báo cáo mang `at` (thời điểm thật lúc đọc); máy chủ chặn `at` không vượt hiện tại và không lùi trước lần báo trước, nên tổng tu vi vẫn bị giới hạn bởi thời gian thật.
- Đăng xuất xóa hàng đợi.
- E2E: `e2e/tests/cultivation.spec.js` (S5): chip, Đột phá, công tắc, offline gom và gửi bù; đã kiểm đột biến (bỏ lưu hàng đợi, chip bỏ qua công tắc).
- Icon cảnh giới: mỗi bậc một icon từ game-icons.net (CC BY 3.0, xem `docs/CREDITS.md`), màu theo Bước (1 xanh ngọc, 2 vàng đồng, 3 tím). Hiện ở chip, banner "Đột phá!" và bảng "Con đường tu luyện" (bấm chip để mở: đủ 18 bậc, đánh dấu bậc hiện tại, ghi alias bậc quá độ). Dữ liệu icon sinh bằng `reader_frontend/scripts/gen-realm-icons.mjs`.
