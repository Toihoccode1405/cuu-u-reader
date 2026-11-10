import { describe, it, expect } from 'vitest';
import { REALMS, BUOC_NAMES, MAX_TU_VI, realmFor } from '../../shared/cultivation.js';

const at = (tuVi) => {
  const r = realmFor(tuVi);
  return [r.name, r.stage, r.tang];
};

// S7 - Bảng cảnh giới: 20 bậc, Bước thứ tư. Mốc đã nhân hệ số 2 (bảng gốc x 2).
describe('S7 - Bảng cảnh giới 20 bậc với Bước thứ tư', () => {
  it('hai bậc cuối: Bán Bộ Đạp Thiên (quá độ Bước 3) và Đạp Thiên Cảnh (Bước 4)', () => {
    expect(REALMS).toHaveLength(20);
    expect(REALMS[17]).toMatchObject({ name: 'Không Kiếp', buoc: 3, from: 11_220_000 });
    expect(REALMS[18]).toMatchObject({ name: 'Bán Bộ Đạp Thiên', alias: 'Đạp Thiên Cửu Kiều', buoc: 3, tangs: 9, quaDo: true, from: 12_290_000 });
    expect(REALMS[19]).toMatchObject({ name: 'Đạp Thiên Cảnh', buoc: 4, tangs: 1, from: 13_490_000 });
    expect(BUOC_NAMES[4]).toBe('Đạp Thiên siêu thoát');
    expect(MAX_TU_VI).toBe(14_890_000);
  });

  it('mốc bắt đầu của 18 bậc cũ giữ nguyên: không ai bị tụt cảnh giới', () => {
    expect(realmFor(0)).toMatchObject({ name: 'Ngưng Khí' });
    expect(realmFor(6_050_000)).toMatchObject({ name: 'Thiên Nhân Suy Kiếp', buoc: 2 });
    expect(realmFor(11_220_000)).toMatchObject({ name: 'Không Kiếp', buoc: 3 });
    expect(realmFor(12_290_000)).toMatchObject({ name: 'Bán Bộ Đạp Thiên', qua_do: true, max: false });
    expect(realmFor(13_490_000)).toMatchObject({ name: 'Đạp Thiên Cảnh', buoc: 4, buoc_name: 'Đạp Thiên siêu thoát' });
  });

  it('đỉnh: 14.890.000 đạt max; vượt trần thì cũng chỉ tới đó', () => {
    expect(realmFor(14_889_999)).toMatchObject({ name: 'Đạp Thiên Cảnh', max: false });
    expect(realmFor(14_890_000)).toMatchObject({ name: 'Đạp Thiên Cảnh', max: true });
    expect(realmFor(99_999_999)).toMatchObject({ name: 'Đạp Thiên Cảnh', max: true });
  });
});

// S8 - Cấp bậc trong cảnh giới (thay cho 9 tầng cũ). Mỗi cảnh giới chia đều cho các cấp của nó.
describe('S8 - Cấp bậc trong cảnh giới', () => {
  it('số cấp của từng cảnh giới', () => {
    const tangs = Object.fromEntries(REALMS.map((r) => [r.name, r.tangs]));
    expect(tangs).toMatchObject({
      'Ngưng Khí': 15, 'Trúc Cơ': 4, 'Kết Đan': 4, 'Nguyên Anh': 4, 'Hóa Thần': 4, 'Anh Biến': 4, 'Vấn Đỉnh': 4,
      'Âm Hư': 1, 'Dương Thực': 1, 'Khuy Niết': 4, 'Tịnh Niết': 4, 'Toái Niết': 4, 'Thiên Nhân Suy Kiếp': 5,
      'Không Niết': 4, 'Không Linh': 4, 'Không Huyền': 4, 'Huyền Kiếp': 9, 'Không Kiếp': 4, 'Bán Bộ Đạp Thiên': 9, 'Đạp Thiên Cảnh': 1,
    });
  });

  it('Ngưng Khí: Tầng 1 đến Tầng 15, mỗi tầng 2000 tu vi', () => {
    expect(at(0)).toEqual(['Ngưng Khí', 'Tầng 1', 1]);
    expect(at(1_999)).toEqual(['Ngưng Khí', 'Tầng 1', 1]);
    expect(at(2_000)).toEqual(['Ngưng Khí', 'Tầng 2', 2]);
    expect(at(27_999)).toEqual(['Ngưng Khí', 'Tầng 14', 14]);
    expect(at(28_000)).toEqual(['Ngưng Khí', 'Tầng 15', 15]);
    expect(at(29_999)).toEqual(['Ngưng Khí', 'Tầng 15', 15]);
  });

  it('cảnh giới thường chia 4 kỳ đều nhau (Trúc Cơ 30.000 → 100.000, mỗi kỳ 17.500)', () => {
    expect(at(30_000)).toEqual(['Trúc Cơ', 'Sơ Kỳ', 1]);
    expect(at(47_499)).toEqual(['Trúc Cơ', 'Sơ Kỳ', 1]);
    expect(at(47_500)).toEqual(['Trúc Cơ', 'Trung Kỳ', 2]);
    expect(at(65_000)).toEqual(['Trúc Cơ', 'Hậu Kỳ', 3]);
    expect(at(82_500)).toEqual(['Trúc Cơ', 'Viên Mãn', 4]);
    expect(at(99_999)).toEqual(['Trúc Cơ', 'Viên Mãn', 4]);
    expect(at(100_000)).toEqual(['Kết Đan', 'Sơ Kỳ', 1]);
  });

  it('Âm Hư, Dương Thực, Đạp Thiên Cảnh chỉ có một cấp (stage null), có thanh tiến độ', () => {
    expect(realmFor(1_700_000)).toMatchObject({ name: 'Âm Hư', stage: null, note: null, tang: 1, tangs: 1, progress: 0 });
    expect(realmFor(2_050_000)).toMatchObject({ name: 'Âm Hư', stage: null, tangs: 1, progress: 0.5 });
    expect(realmFor(2_400_000)).toMatchObject({ name: 'Dương Thực', stage: null });
    expect(realmFor(14_190_000)).toMatchObject({ name: 'Đạp Thiên Cảnh', stage: null, tangs: 1, progress: 0.5 });
  });

  it('Thiên Nhân Suy Kiếp: Đệ Nhất Suy đến Đệ Ngũ Suy, mỗi suy 200.000', () => {
    expect(at(6_050_000)).toEqual(['Thiên Nhân Suy Kiếp', 'Đệ Nhất Suy', 1]);
    expect(at(6_500_000)).toEqual(['Thiên Nhân Suy Kiếp', 'Đệ Tam Suy', 3]);
    expect(at(6_849_999)).toEqual(['Thiên Nhân Suy Kiếp', 'Đệ Tứ Suy', 4]);
    expect(at(6_850_000)).toEqual(['Thiên Nhân Suy Kiếp', 'Đệ Ngũ Suy', 5]);
  });

  it('Huyền Kiếp: 9 kiếp có tên, nhóm Ngoại Kiếp / Nội Kiếp / Hồn Kiếp nằm ở note', () => {
    const got = [];
    for (let i = 0; i < 9; i++) {
      const r = realmFor(10_160_000 + Math.floor(i * (1_060_000 / 9)) + 1);
      got.push([r.stage, r.note]);
    }
    expect(got).toEqual([
      ['Tuyết Kiếp', 'Ngoại Kiếp'], ['Phong Kiếp', 'Ngoại Kiếp'], ['Lôi Kiếp', 'Ngoại Kiếp'],
      ['Trảm Ly Kiếp', 'Nội Kiếp'], ['Huyết Ảnh Kiếp', 'Nội Kiếp'], ['Kiếp Chưa Hiện', 'Nội Kiếp'],
      ['Thập Tức Khô Thần Kiếp', 'Hồn Kiếp'], ['Hồn Thọ Kiếp', 'Hồn Kiếp'], ['Luân Hồi Kiếp', 'Hồn Kiếp'],
    ]);
    // mốc biên giữa Lôi Kiếp và Trảm Ly Kiếp (10.160.000 + 3 x 117.777,8 = 10.513.333,3)
    expect(realmFor(10_513_333).stage).toBe('Lôi Kiếp');
    expect(realmFor(10_513_334).stage).toBe('Trảm Ly Kiếp');
  });

  it('Không Kiếp (Đại Tôn): 4 kỳ, mỗi kỳ 267.500', () => {
    expect(at(11_220_000)).toEqual(['Không Kiếp', 'Sơ Kỳ', 1]);
    expect(at(11_487_500)).toEqual(['Không Kiếp', 'Trung Kỳ', 2]);
    expect(at(11_755_000)).toEqual(['Không Kiếp', 'Hậu Kỳ', 3]);
    expect(at(12_022_500)).toEqual(['Không Kiếp', 'Viên Mãn', 4]);
    expect(at(12_289_999)).toEqual(['Không Kiếp', 'Viên Mãn', 4]);
  });

  it('danh hiệu của Không Kiếp kèm điều kiện, không phải cấp', () => {
    const kk = REALMS.find((r) => r.name === 'Không Kiếp');
    expect(kk.titles).toEqual([
      { name: 'Kim Tôn', cond: 'Hậu Kỳ đỉnh phong' },
      { name: 'Thiên Tôn', cond: 'Viên Mãn' },
      { name: 'Dược Thiên Tôn', cond: 'Quá độ' },
      { name: 'Đại Thiên Tôn', cond: 'ngưng tụ Thiên Tôn Chi Dương' },
    ]);
  });

  it('Bán Bộ Đạp Thiên: Đệ Nhất Kiều đến Đệ Cửu Kiều; ba cầu đầu có chú thích', () => {
    expect(realmFor(12_290_000)).toMatchObject({ stage: 'Đệ Nhất Kiều', note: 'Dung nhập quy tắc thiên địa vào thần thức', tang: 1 });
    expect(realmFor(12_423_333)).toMatchObject({ stage: 'Đệ Nhất Kiều' });
    expect(realmFor(12_423_334)).toMatchObject({ stage: 'Đệ Nhị Kiều', note: 'Đạp Thiên Nhãn', tang: 2 });
    expect(realmFor(12_556_667)).toMatchObject({ stage: 'Đệ Tam Kiều', note: 'Vấn Đạo Tâm', tang: 3 });
    expect(realmFor(12_690_000)).toMatchObject({ stage: 'Đệ Tứ Kiều', note: null, tang: 4 });
    expect(realmFor(13_356_666)).toMatchObject({ stage: 'Đệ Bát Kiều', tang: 8 });
    expect(realmFor(13_356_667)).toMatchObject({ stage: 'Đệ Cửu Kiều', tang: 9 });
    expect(realmFor(13_489_999)).toMatchObject({ stage: 'Đệ Cửu Kiều', tang: 9, max: false });
  });
});
