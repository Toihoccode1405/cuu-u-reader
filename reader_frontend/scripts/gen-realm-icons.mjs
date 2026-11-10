// Sinh src/realmIconData.js từ bộ icon SVG động của dự án (docs/brand/realms_full.html).
// Chạy lại: node scripts/gen-realm-icons.mjs  (chỉ cần khi đổi icon; kết quả được commit)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../docs/brand/realms_full.html', import.meta.url));
const OUT = fileURLToPath(new URL('../src/realmIconData.js', import.meta.url));

// Màu Tailwind dùng trong file nguồn (lớp text-*), để ánh sáng "thở" đúng màu mà không cần Tailwind
const TW = {
  'cyan-400': '#22d3ee', 'emerald-400': '#34d399', 'amber-400': '#fbbf24', 'indigo-400': '#818cf8',
  'slate-100': '#f1f5f9', 'red-400': '#f87171', 'yellow-300': '#fde047', 'pink-400': '#f472b6',
  'purple-400': '#c084fc', 'rose-400': '#fb7185', 'purple-300': '#d8b4fe', 'sky-400': '#38bdf8',
  'teal-400': '#2dd4bf', 'yellow-200': '#fef08a',
};

// Cảnh giới của ứng dụng -> id icon trong file nguồn
const MAP = {
  'Ngưng Khí': 1, 'Trúc Cơ': 2, 'Kết Đan': 3, 'Nguyên Anh': 4, 'Hóa Thần': 5, 'Anh Biến': 6, 'Vấn Đỉnh': 7,
  'Âm Hư': 8, 'Dương Thực': 8, 'Khuy Niết': 9, 'Tịnh Niết': 10, 'Toái Niết': 11, 'Thiên Nhân Suy Kiếp': 12,
  'Không Niết': 13, 'Không Linh': 14, 'Không Huyền': 15, 'Huyền Kiếp': 15, 'Không Kiếp': 16,
};

const html = readFileSync(SRC, 'utf8');
const start = html.indexOf('const realmsData = ');
const end = html.indexOf('\n    ];', start);
if (start < 0 || end < 0) throw new Error('Không tìm thấy realmsData trong file nguồn');
const realms = new Function(`return ${html.slice(start + 'const realmsData = '.length, end + 6)}`)();
const byId = new Map(realms.map((r) => [r.id, r]));

function parse(svg) {
  const m = svg.match(/^<svg[^>]*class="[^"]*\btext-([a-z]+-\d+)[^"]*"[^>]*>([\s\S]*)<\/svg>$/);
  if (!m || !TW[m[1]]) throw new Error('SVG không đọc được / thiếu màu: ' + svg.slice(0, 80));
  const body = m[2]
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s*class="spin-slow"/g, ' class="realm-spin"')
    .replace(/\n\s*/g, '')
    .trim();
  return { color: TW[m[1]], body };
}

// Các bậc dùng chung một hình trong file nguồn được tách ra bằng một biến thể nhỏ để mỗi bậc một hình riêng
const VARIANT = {
  // Âm Hư: nửa lam (âm) sáng, nửa đỏ (dương) mờ; Dương Thực ngược lại
  'Âm Hư': (b) => b.replace('stroke="#ef4444" stroke-width="6"', 'stroke="#ef4444" stroke-width="6" opacity="0.25"'),
  'Dương Thực': (b) => b.replace('stroke="#38bdf8" stroke-width="6"', 'stroke="#38bdf8" stroke-width="6" opacity="0.25"'),
  // Huyền Kiếp: thêm vòng lôi kiếp nét đứt xoay quanh hình thoi của Không Huyền
  'Huyền Kiếp': (b) => b.replace('<circle cx="50" cy="50" r="8"', '<circle cx="50" cy="50" r="38" fill="none" stroke="#a5b4fc" stroke-width="1.5" stroke-dasharray="3,4" class="realm-spin"/><circle cx="50" cy="50" r="8"'),
};

const out = {};
for (const [name, id] of Object.entries(MAP)) {
  const r = byId.get(id);
  if (!r) throw new Error('Thiếu icon id ' + id);
  const { color, body } = parse(r.svg);
  const b = VARIANT[name] ? VARIANT[name](body) : body;
  if (b === body && VARIANT[name]) throw new Error('Biến thể không áp dụng được: ' + name);
  out[name] = { source: r.name, color, body: b };
}

writeFileSync(OUT, `// TỰ SINH bởi scripts/gen-realm-icons.mjs từ docs/brand/realms_full.html. Đừng sửa tay.\n// Khung 100x100, mỗi icon có màu "thở" riêng (color) và vòng xoay .realm-spin.\nexport default ${JSON.stringify(out, null, 2)};\n`);
console.log('ok', Object.keys(out).length);
