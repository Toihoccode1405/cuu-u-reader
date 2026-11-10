// Luật tu vi: bảng cảnh giới và cách đếm từ. Thuần hàm, không phụ thuộc môi trường.
// Tu vi = tổng số từ đã đọc. Mốc `from` là tu vi bắt đầu của cảnh giới đó.

export const BUOC_NAMES = {
  1: 'Nhất bộ tung hoành',
  2: 'Nhị bộ phi thăng',
  3: 'Tam bộ vô biên',
  4: 'Đạp Thiên siêu thoát',
};

// Hệ số độ khó: nhân mọi mốc cảnh giới. Bảng dưới là mốc gốc (đọc ~1 năm là gần đầy), hệ số 2 làm đột phá khó gấp đôi.
export const TU_VI_SCALE = 2;

// Cấp bậc trong cảnh giới (thay cho "tầng" cũ). Mỗi cảnh giới chia đều độ rộng cho các cấp của nó.
// stages: [] = chỉ một cấp duy nhất (chỉ có thanh tiến độ). Phần tử: { name, note? }
const KY = ['Sơ Kỳ', 'Trung Kỳ', 'Hậu Kỳ', 'Viên Mãn'].map((name) => ({ name }));
const TANG_15 = Array.from({ length: 15 }, (_, i) => ({ name: `Tầng ${i + 1}` }));
const SUY = ['Nhất', 'Nhị', 'Tam', 'Tứ', 'Ngũ'].map((n) => ({ name: `Đệ ${n} Suy` }));
const KIEP = [
  ['Tuyết Kiếp', 'Ngoại Kiếp'], ['Phong Kiếp', 'Ngoại Kiếp'], ['Lôi Kiếp', 'Ngoại Kiếp'],
  ['Trảm Ly Kiếp', 'Nội Kiếp'], ['Huyết Ảnh Kiếp', 'Nội Kiếp'], ['Kiếp Chưa Hiện', 'Nội Kiếp'],
  ['Thập Tức Khô Thần Kiếp', 'Hồn Kiếp'], ['Hồn Thọ Kiếp', 'Hồn Kiếp'], ['Luân Hồi Kiếp', 'Hồn Kiếp'],
].map(([name, note]) => ({ name, note }));
const KIEU_NOTES = ['Dung nhập quy tắc thiên địa vào thần thức', 'Đạp Thiên Nhãn', 'Vấn Đạo Tâm'];
const KIEU = ['Nhất', 'Nhị', 'Tam', 'Tứ', 'Ngũ', 'Lục', 'Thất', 'Bát', 'Cửu'].map((n, i) => ({ name: `Đệ ${n} Kiều`, note: KIEU_NOTES[i] }));

const BASE_REALMS = [
  { name: 'Ngưng Khí', buoc: 1, stages: TANG_15, from: 0 },
  { name: 'Trúc Cơ', buoc: 1, stages: KY, from: 15_000 },
  { name: 'Kết Đan', buoc: 1, stages: KY, from: 50_000 },
  { name: 'Nguyên Anh', buoc: 1, stages: KY, from: 110_000 },
  { name: 'Hóa Thần', buoc: 1, stages: KY, from: 210_000 },
  { name: 'Anh Biến', buoc: 1, stages: KY, from: 360_000 },
  { name: 'Vấn Đỉnh', buoc: 1, stages: KY, from: 570_000 },
  { name: 'Âm Hư', buoc: 1, stages: [], from: 850_000, quaDo: true },
  { name: 'Dương Thực', buoc: 1, stages: [], from: 1_200_000, quaDo: true },
  { name: 'Khuy Niết', buoc: 2, stages: KY, from: 1_610_000 },
  { name: 'Tịnh Niết', buoc: 2, stages: KY, from: 2_060_000 },
  { name: 'Toái Niết', buoc: 2, stages: KY, from: 2_535_000 },
  { name: 'Thiên Nhân Suy Kiếp', alias: 'Phá Không Ngũ Chỉ', buoc: 2, stages: SUY, from: 3_025_000, quaDo: true },
  { name: 'Không Niết', buoc: 3, stages: KY, from: 3_525_000 },
  { name: 'Không Linh', buoc: 3, stages: KY, from: 4_035_000 },
  { name: 'Không Huyền', buoc: 3, stages: KY, from: 4_555_000 },
  { name: 'Huyền Kiếp', buoc: 3, stages: KIEP, from: 5_080_000 },
  {
    name: 'Không Kiếp', buoc: 3, stages: KY, from: 5_610_000,
    // Danh hiệu chiến lực gắn với tình trạng của Không Kiếp, không phải cấp
    titles: [
      { name: 'Kim Tôn', cond: 'Hậu Kỳ đỉnh phong' },
      { name: 'Thiên Tôn', cond: 'Viên Mãn' },
      { name: 'Dược Thiên Tôn', cond: 'Quá độ' },
      { name: 'Đại Thiên Tôn', cond: 'ngưng tụ Thiên Tôn Chi Dương' },
    ],
  },
  { name: 'Bán Bộ Đạp Thiên', alias: 'Đạp Thiên Cửu Kiều', buoc: 3, stages: KIEU, from: 6_145_000, quaDo: true },
  { name: 'Đạp Thiên Cảnh', buoc: 4, stages: [], from: 6_745_000 },
];

export const REALMS = BASE_REALMS.map((r) => ({ ...r, tangs: Math.max(1, r.stages.length), from: r.from * TU_VI_SCALE }));

// Tu vi tối đa: hết cấp cuối của cảnh giới cuối cùng
export const MAX_TU_VI = 7_445_000 * TU_VI_SCALE;

// Tốc độ đọc tối đa được tính (từ/giây = 1200 từ/phút) và thời gian tối đa của một lần báo
export const MAX_WORDS_PER_SECOND = 20;
export const MAX_REPORT_SECONDS = 120;

export function realmFor(tuVi) {
  const v = Math.max(0, Math.min(MAX_TU_VI, Math.floor(Number(tuVi) || 0)));
  let i = REALMS.length - 1;
  while (i > 0 && v < REALMS[i].from) i--;
  const r = REALMS[i];
  const end = i + 1 < REALMS.length ? REALMS[i + 1].from : MAX_TU_VI;
  const size = (end - r.from) / r.tangs;
  const tang = Math.min(r.tangs, Math.floor((v - r.from) / size) + 1);
  const tangStart = r.from + (tang - 1) * size;
  return {
    name: r.name,
    alias: r.alias || null,
    buoc: r.buoc,
    buoc_name: BUOC_NAMES[r.buoc],
    qua_do: !!r.quaDo,
    tang,
    tangs: r.tangs,
    stage: r.stages[tang - 1]?.name ?? null,
    note: r.stages[tang - 1]?.note ?? null,
    progress: Math.min(1, (v - tangStart) / size),
    max: v >= MAX_TU_VI,
  };
}

function stripTags(s) {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// Số từ của từng đoạn đọc được, cùng quy tắc với giao diện đánh số đoạn (data-p):
// mỗi đoạn là một khối <p> có từ 2 ký tự trở lên sau khi bỏ khoảng trắng đầu cuối.
export function paragraphWordCounts(html) {
  const counts = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    const text = stripTags(m[1]).trim();
    if (text.length < 2) continue;
    counts.push(text.split(/\s+/).filter(Boolean).length);
  }
  return counts;
}
