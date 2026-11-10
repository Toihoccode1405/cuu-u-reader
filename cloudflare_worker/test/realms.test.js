import { describe, it, expect } from 'vitest';
import { REALMS, BUOC_NAMES, MAX_TU_VI, realmFor } from '../../shared/cultivation.js';

// S7 - Bảng cảnh giới: 20 bậc, Bước thứ tư. Mốc đã nhân hệ số 2 (bảng gốc x 2).
describe('S7 - Bảng cảnh giới 20 bậc với Bước thứ tư', () => {
  it('hai bậc mới nối sau Không Kiếp: Bán Bộ Đạp Thiên (quá độ Bước 3) và Đạp Thiên Cảnh (Bước 4), mỗi bậc 9 tầng', () => {
    expect(REALMS).toHaveLength(20);
    expect(REALMS[17]).toMatchObject({ name: 'Không Kiếp', buoc: 3, from: 11_220_000 });
    expect(REALMS[18]).toMatchObject({ name: 'Bán Bộ Đạp Thiên', alias: 'Đạp Thiên Cửu Kiều', buoc: 3, tangs: 9, quaDo: true, from: 12_290_000 });
    expect(REALMS[19]).toMatchObject({ name: 'Đạp Thiên Cảnh', buoc: 4, tangs: 9, from: 13_490_000 });
    expect(BUOC_NAMES[4]).toBe('Đạp Thiên siêu thoát');
    expect(MAX_TU_VI).toBe(14_890_000);
  });

  it('18 bậc cũ giữ nguyên mốc: không ai bị tụt cảnh giới', () => {
    expect(realmFor(0)).toMatchObject({ name: 'Ngưng Khí', tang: 1 });
    expect(realmFor(6_050_000)).toMatchObject({ name: 'Thiên Nhân Suy Kiếp', tang: 1, buoc: 2 });
    expect(realmFor(11_220_000)).toMatchObject({ name: 'Không Kiếp', tang: 1, buoc: 3 });
    expect(realmFor(12_289_999)).toMatchObject({ name: 'Không Kiếp', tang: 9, max: false });
  });

  it('tu vi 12.290.000 (mức tối đa cũ) giờ là Bán Bộ Đạp Thiên tầng 1, chưa phải đỉnh', () => {
    expect(realmFor(12_290_000)).toMatchObject({
      name: 'Bán Bộ Đạp Thiên', alias: 'Đạp Thiên Cửu Kiều', buoc: 3, qua_do: true, tang: 1, tangs: 9, max: false,
    });
  });

  it('mốc biên tầng của Bán Bộ Đạp Thiên: tầng 9 bắt đầu ở 13.356.667', () => {
    expect(realmFor(13_356_666)).toMatchObject({ name: 'Bán Bộ Đạp Thiên', tang: 8 });
    expect(realmFor(13_356_667)).toMatchObject({ name: 'Bán Bộ Đạp Thiên', tang: 9 });
    expect(realmFor(13_489_999)).toMatchObject({ name: 'Bán Bộ Đạp Thiên', tang: 9, max: false });
  });

  it('13.490.000 vào Bước thứ tư: Đạp Thiên Cảnh tầng 1', () => {
    expect(realmFor(13_490_000)).toMatchObject({ name: 'Đạp Thiên Cảnh', buoc: 4, buoc_name: 'Đạp Thiên siêu thoát', qua_do: false, tang: 1, tangs: 9 });
  });

  it('đỉnh: 14.890.000 là Đạp Thiên Cảnh tầng 9 và đạt max; vượt trần thì cũng chỉ tới đó', () => {
    expect(realmFor(14_889_999)).toMatchObject({ name: 'Đạp Thiên Cảnh', tang: 9, max: false });
    expect(realmFor(14_890_000)).toMatchObject({ name: 'Đạp Thiên Cảnh', tang: 9, max: true });
    expect(realmFor(99_999_999)).toMatchObject({ name: 'Đạp Thiên Cảnh', tang: 9, max: true });
  });
});
