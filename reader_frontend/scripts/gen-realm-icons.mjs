// Sinh src/realmIconData.js từ bộ icon game-icons.net (CC BY 3.0, qua @iconify-json/game-icons).
// Chạy lại: node scripts/gen-realm-icons.mjs  (chỉ cần khi đổi icon; kết quả được commit)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const set = require('@iconify-json/game-icons/icons.json');

const MAP = {
  'Ngưng Khí': 'whirlwind',
  'Trúc Cơ': 'stairs',
  'Kết Đan': 'concentration-orb',
  'Nguyên Anh': 'embryo',
  'Hóa Thần': 'soul',
  'Anh Biến': 'magic-swirl',
  'Vấn Đỉnh': 'cauldron',
  'Âm Hư': 'moon',
  'Dương Thực': 'barbed-sun',
  'Khuy Niết': 'eclipse',
  'Tịnh Niết': 'lotus',
  'Toái Niết': 'shatter',
  'Thiên Nhân Suy Kiếp': 'lightning-branches',
  'Không Niết': 'portal',
  'Không Linh': 'spark-spirit',
  'Không Huyền': 'galaxy',
  'Huyền Kiếp': 'thunderball',
  'Không Kiếp': 'nested-eclipses',
};

const out = {};
for (const [realm, icon] of Object.entries(MAP)) {
  const entry = set.icons[icon];
  if (!entry) throw new Error(`Không có icon ${icon}`);
  out[realm] = { icon, body: entry.body };
}

const header = `// TỰ SINH bởi scripts/gen-realm-icons.mjs. Đừng sửa tay.
// Icon: game-icons.net (CC BY 3.0) https://game-icons.net — xem docs/CREDITS.md. Khung 512x512.
`;
writeFileSync(new URL('../src/realmIconData.js', import.meta.url), `${header}export default ${JSON.stringify(out, null, 2)};\n`);
console.log('Đã sinh', Object.keys(out).length, 'icon');
void readFileSync;
