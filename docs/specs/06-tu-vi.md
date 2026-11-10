# Spec 06 - Tu vi và cảnh giới

## Ý tưởng
Đọc truyện thì tích **tu vi**; tu vi quyết định **cảnh giới** (20 bậc theo Tiên Nghịch, chia bốn **Bước**; từ 2026-11-10 có Bước thứ tư). Mục tiêu: có cảm giác tiến bộ khi đọc, không gây áp lực.

## Luật
- Tu vi = tổng số từ đã đọc. Một người đọc có một tu vi chung cho mọi sách; xóa sách không làm mất tu vi.
- Đọc lại vẫn cộng. Chống lướt bằng tốc độ, không bằng "mỗi chương một lần".
- Máy chủ tự đếm từ từ nội dung chương nó lưu; trình duyệt chỉ báo khoảng đoạn và số giây.
  - Tối đa 1200 từ/phút (20 từ/giây) theo số giây khai.
  - Số giây bị chặn bởi thời gian thật trôi qua từ lần báo trước, và tối đa 120 giây mỗi lần.
  - Lần báo đầu tiên được tính tối đa 120 giây.
- Đoạn = khối `<p>` có từ 2 ký tự trở lên (cùng quy tắc đánh số `data-p` của giao diện). Đoạn ngoài phạm vi bị bỏ qua.
- Tu vi tối đa 14.890.000 (hết tầng cuối của Đạp Thiên Cảnh). Trước 2026-11-10 là 12.290.000 (hết Không Kiếp); hai bậc mới nối thêm ở cuối, mọi mốc cũ giữ nguyên nên không ai bị tụt cảnh giới.
- Độ khó: mọi mốc cảnh giới nhân với `TU_VI_SCALE` (hiện là 2, đặt ngày 2026-11-10 theo yêu cầu "đột phá khó gấp đôi"). Bảng gốc ở `shared/cultivation.js` giữ nguyên, chỉ đổi hệ số này. Tu vi người dùng đã tích không bị reset, nên cảnh giới hiển thị có thể thấp hơn trước.
- Cảnh giới và tầng suy ra từ tu vi; mỗi cảnh giới chia đều theo tầng (9 tầng, riêng Thiên Nhân Suy Kiếp 5 tầng). Bảng mốc ở `shared/cultivation.js`, một hệ số chỉnh được ở một nơi.
- Đột phá = lên tầng hoặc cảnh giới mới sau một lần báo.
- Công tắc: tắt chỉ ẩn giao diện, máy chủ vẫn ghi, bật lại không mất gì.
- Cộng hồi tố một lần duy nhất: các chương đứng trước chương đang đọc của mọi sách. Chương đã tách thì đếm thật; chương chưa tách chỉ tách thêm tối đa 40 chương mỗi lần, phần còn lại ước lượng theo số từ trung bình của sách đó (đo cho thấy tách 299 chương trong một lần mất ~19 giây, quá rủi ro trên Worker).

## Mốc cảnh giới (từ, đã nhân hệ số 2)
| Bước | Cảnh giới | Mốc |
|---|---|---|
| 1 | Ngưng Khí / Trúc Cơ / Kết Đan / Nguyên Anh / Hóa Thần / Anh Biến / Vấn Đỉnh | 0 / 30k / 100k / 220k / 420k / 720k / 1,14tr |
| 1 | Âm Hư, Dương Thực (quá độ) | 1,7tr / 2,4tr |
| 2 | Khuy Niết / Tịnh Niết / Toái Niết | 3,22tr / 4,12tr / 5,07tr |
| 2 | Thiên Nhân Suy Kiếp (5 tầng, quá độ) | 6,05tr |
| 3 | Không Niết / Không Linh / Không Huyền / Huyền Kiếp / Không Kiếp | 7,05tr / 8,07tr / 9,11tr / 10,16tr / 11,22tr |
| 3 | Bán Bộ Đạp Thiên (Đạp Thiên Cửu Kiều, quá độ, 9 tầng) | 12,29tr |
| 4 | Đạp Thiên Cảnh (9 tầng, "Đạp Thiên siêu thoát") | 13,49tr |

Bảng gốc (chưa nhân 2) của hai bậc mới: 6.145.000 và 6.745.000, đỉnh 7.445.000; rộng hơn các bậc trước (600k và 700k so với ~535k) vì là đỉnh cao. Danh hiệu chiến lực Kim Tôn / Thiên Tôn / Dược Thiên Tôn / Đại Thiên Tôn chỉ là dòng chữ nhỏ dưới Không Kiếp trong bảng, không phải bậc.

Với 2 giờ đọc mỗi ngày (~13 triệu từ/năm) thì đầy trong khoảng 13 tháng (trước đây 11-12 tháng).

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
- Icon cảnh giới: mỗi bậc một icon từ game-icons.net (CC BY 3.0, xem `docs/CREDITS.md`), màu theo Bước (1 xanh ngọc, 2 vàng đồng, 3 tím). Hiện ở chip, banner "Đột phá!" và bảng "Con đường tu luyện" (bấm chip để mở: đủ 20 bậc, đánh dấu bậc hiện tại, ghi alias bậc quá độ). Dữ liệu icon sinh bằng `reader_frontend/scripts/gen-realm-icons.mjs`.

## Bước thứ tư (2026-11-10)
Theo thiết lập "tu đạo chia 4 bước": Bước 1 là chữ "tu", Bước 2 là cầu nối, Bước 3 là chữ "đạo", Bước 4 siêu thoát luân hồi, đứng trên thiên đạo. Bán Bộ Đạp Thiên (Đạp Thiên Cửu Kiều) là bậc quá độ của Bước 3 (9 tầng = 9 cây cầu); Đạp Thiên Cảnh là bậc duy nhất của Bước 4. Màu chủ đạo Bước 4 là đỏ thẫm `#b3263e`.
Kiểm thử: `cloudflare_worker/test/realms.test.js` (S7: mốc biên, 20 bậc, max), `cultivation.test.js` (đọc vượt trần chỉ dừng ở 14.890.000), `e2e/tests/realm-icons.spec.js` (bảng 20 bậc, đề mục Bước thứ tư, danh hiệu, icon). Đã kiểm đột biến: đổi Bước của Đạp Thiên Cảnh, bỏ dòng danh hiệu.
