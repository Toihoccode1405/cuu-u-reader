// Cảnh đánh nhau pixel-art vẽ bằng canvas 2D, không dùng ảnh ngoài, không gọi mạng.
// Hai tu sĩ: kiếm tu áo xanh (A, bên trái) và ma tu áo đỏ (B, bên phải) lần lượt ra chiêu:
// chém kiếm, phi kiếm / cầu ma khí, lôi kiếp, nổ linh lực. Mỗi trận gồm 4 chiêu theo thứ tự ngẫu nhiên.

export const W = 96;
export const H = 54;
export const SCENE_MS = 3600;
const MOVE_MS = 900;
const GROUND = 46;
const AX = 22; // vị trí gốc của hai người
const BX = 74;

const INK = '#15131f';
const SKIN_A = '#f3d2b0';
const SKIN_B = '#c9a8dc';
const A = { robe: '#e9f1ff', shade: '#9db8e6', sash: '#2f6df0', hair: '#1c1b2b', glow: '#7fe4ff', glow2: '#e8fbff', trail: '#4fb4ff' };
const B = { robe: '#46132a', shade: '#2a0c1a', sash: '#e03a3a', hair: '#9b1b30', glow: '#ff6a3d', glow2: '#ffd36b', trail: '#c42a3a' };

export const MOVES = ['slash', 'throw', 'lightning', 'blast'];

// Lập kịch bản một trận: 4 chiêu, hai bên thay phiên (bên nào đánh trước do rng quyết định)
export function planScene(rng = Math.random) {
  const order = [...MOVES].sort(() => rng() - 0.5);
  const first = rng() < 0.5 ? 0 : 1;
  return order.map((type, i) => ({ type, who: (first + i) % 2, at: i * MOVE_MS, dur: MOVE_MS }));
}

const px = (ctx, c, x, y, w = 1, h = 1) => {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

// Một tu sĩ: dir = +1 nhìn sang phải, -1 nhìn sang trái. lean: nghiêng người khi ra chiêu; flash: trắng khi bị đánh.
function fighter(ctx, x, y, dir, P, skin, { lean = 0, hurt = 0, bob = 0, arm = 0, demon = false }) {
  const f = (dx, dy, w, h, c) => px(ctx, c, x + dir * dx - (dir < 0 ? w - 1 : 0) + lean * dir, y + dy + bob, w, h);
  const flash = hurt > 0 && Math.floor(hurt * 12) % 2 === 0;
  const robe = flash ? '#ffffff' : P.robe;
  const shade = flash ? '#ffd9d9' : P.shade;
  // bóng đất
  px(ctx, 'rgba(0,0,0,0.22)', x - 6, GROUND + 1, 13, 1);
  px(ctx, 'rgba(0,0,0,0.12)', x - 8, GROUND + 2, 17, 1);
  // chân
  f(-3, 17, 3, 5, INK); f(1, 17, 3, 5, INK);
  f(-3, 17, 2, 4, shade); f(1, 17, 2, 4, shade);
  // áo choàng
  f(-5, 7, 11, 11, INK); f(-4, 8, 9, 10, robe); f(-4, 12, 9, 6, shade);
  // đai
  f(-4, 12, 9, 2, P.sash);
  // đầu
  f(-3, 0, 7, 7, INK); f(-2, 1, 5, 5, skin);
  // mắt
  px(ctx, INK, x + dir * 2 + lean * dir, y + 3 + bob, 1, 1);
  // tóc
  f(-3, -1, 7, 2, INK); f(-2, -1, 5, 1, P.hair);
  if (demon) { f(-3, -4, 1, 3, '#f4d03f'); f(3, -4, 1, 3, '#f4d03f'); f(-3, -5, 1, 1, '#ffe98a'); f(3, -5, 1, 1, '#ffe98a'); }
  else { f(0, -4, 2, 3, INK); f(0, -4, 2, 1, P.glow); f(-4, 1, 1, 8, P.hair); } // búi tóc + tóc dài
  // tay cầm vũ khí (arm: 0 hạ, 1 giơ ngang, 2 vung thẳng)
  const ay = arm === 0 ? 11 : arm === 1 ? 9 : 8;
  f(5, ay, 4, 2, INK); f(5, ay, 3, 1, skin);
  return { handX: x + dir * 9 + lean * dir, handY: y + ay + bob };
}

function sword(ctx, hx, hy, dir, len, P, angle) {
  // angle 0: ngang, 1: chếch lên, -1: chếch xuống. Lưỡi dày 2 điểm ảnh, viền mực để nổi trên nền sáng lẫn tối
  for (let i = 0; i < len; i++) {
    const x = hx + dir * i;
    const y = hy + (angle === 0 ? 0 : angle === 1 ? -Math.floor(i / 2) : Math.floor(i / 2));
    if (i >= 2) { px(ctx, INK, x, y - 1, 1, 1); px(ctx, INK, x, y + 2, 1, 1); }
    px(ctx, i < 2 ? '#7a5a2a' : P.glow2, x, y, 1, 1);
    if (i >= 2) px(ctx, P.glow, x, y + 1, 1, 1);
  }
  px(ctx, INK, hx + dir * len, hy, 1, 2);
}

const ease = (t) => 1 - (1 - t) * (1 - t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

function effect(ctx, mv, p, atk, def, P, seed) {
  const dir = atk.x < def.x ? 1 : -1;
  const hy = def.y + 12;
  if (mv.type === 'slash') {
    // trăng khuyết kiếm khí quét qua trước mặt đối thủ
    const t = clamp01((p - 0.25) / 0.45);
    if (t > 0 && t < 1) {
      const cx = atk.x + dir * (8 + 26 * ease(t));
      for (let i = -9; i <= 9; i++) {
        const x = cx + dir * Math.round(Math.pow(i / 3, 2) * -0.6 + 3);
        px(ctx, P.glow, x + dir, hy + i, 1, 1);
        px(ctx, P.glow2, x, hy + i, 1, 1);
        if (Math.abs(i) < 7) px(ctx, P.glow2, x - dir, hy + i, 1, 1);
      }
    }
  } else if (mv.type === 'throw') {
    // phi kiếm (kiếm tu) hoặc cầu ma khí (ma tu) bay từ tay sang đối thủ, để lại vệt
    const t = clamp01((p - 0.2) / 0.5);
    if (t > 0 && t < 1) {
      const x = atk.x + dir * (10 + 40 * ease(t));
      const y = hy - Math.round(Math.sin(t * Math.PI) * 4);
      for (let k = 1; k < 9; k++) px(ctx, P.trail, x - dir * k * 2, y + (k % 2), 1, 1);
      if (atk.sword) { for (let i = 0; i < 7; i++) px(ctx, i > 4 ? '#7a5a2a' : P.glow2, x + dir * i * (dir > 0 ? 1 : 1) - (dir < 0 ? 6 : 0), y, 1, 1); px(ctx, P.glow, x - dir, y + 1, 5, 1); }
      else { px(ctx, P.glow, x - 2, y - 2, 5, 5); px(ctx, P.glow2, x - 1, y - 1, 3, 3); px(ctx, INK, x, y, 1, 1); }
    }
  } else if (mv.type === 'lightning') {
    // tia sét bổ từ trên xuống đầu đối thủ, lóe 2–3 nhịp
    const t = clamp01((p - 0.3) / 0.35);
    if (t > 0 && t < 1 && Math.floor(t * 8) % 2 === 0) {
      let x = def.x;
      let r = seed;
      for (let y = 0; y < GROUND - 2; y++) {
        r = (r * 9301 + 49297) % 233280;
        if (y % 4 === 0) x += (r / 233280 > 0.5 ? 1 : -1) * 2;
        x = def.x + Math.max(-4, Math.min(4, x - def.x));
        px(ctx, P.glow, x - 1, y, 1, 1);
        px(ctx, P.glow2, x, y, 1, 1);
        px(ctx, P.glow, x + 1, y, 1, 1);
      }
      px(ctx, P.glow2, def.x - 5, GROUND - 3, 11, 2);
    }
    // mây sét trên đầu
    if (p > 0.1 && p < 0.8) { px(ctx, 'rgba(70,70,110,0.85)', def.x - 12, 0, 24, 2); px(ctx, 'rgba(70,70,110,0.6)', def.x - 8, 2, 16, 1); }
  } else if (mv.type === 'blast') {
    // nổ linh lực: vòng pixel nở ra rồi tan
    const t = clamp01((p - 0.3) / 0.6);
    if (t > 0 && t < 1) {
      const r = 3 + Math.round(13 * ease(t));
      const cx = def.x;
      const cy = hy;
      for (let a = 0; a < 40; a++) {
        const ang = (a / 40) * Math.PI * 2;
        const x = cx + Math.round(Math.cos(ang) * r);
        const y = cy + Math.round(Math.sin(ang) * r * 0.8);
        px(ctx, a % 3 === 0 ? P.glow2 : P.glow, x, y, 2, 2);
        if (t < 0.6) px(ctx, P.trail, cx + Math.round(Math.cos(ang) * (r - 4)), cy + Math.round(Math.sin(ang) * (r - 4) * 0.8), 1, 1);
      }
      if (t < 0.35) px(ctx, P.glow2, cx - 4, cy - 4, 9, 9);
    }
  }
}

// Vẽ khung hình tại thời điểm t (ms) của một kịch bản. Trả về true nếu vẫn còn cảnh để vẽ.
export function drawFrame(ctx, scene, t, seed = 1) {
  ctx.clearRect(0, 0, W, H);
  if (t >= SCENE_MS) return false;
  const mvNow = scene.find((m) => t >= m.at && t < m.at + m.dur) || scene[scene.length - 1];
  const p = clamp01((t - mvNow.at) / mvNow.dur);
  const state = [{ x: AX, dir: 1, P: A, skin: SKIN_A, demon: false, sword: true }, { x: BX, dir: -1, P: B, skin: SKIN_B, demon: true, sword: false }];

  const fx = [];
  state.forEach((s, who) => {
    const attacking = mvNow.who === who;
    const defending = !attacking;
    const phase = attacking ? p : p;
    let lean = 0;
    let arm = 0;
    let hurt = 0;
    let bob = Math.round(Math.sin(t / 220 + who * 2) * 0.6);
    if (attacking) {
      const wind = p < 0.25 ? p / 0.25 : p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      lean = Math.round(2 * wind);
      arm = p < 0.2 ? 1 : p < 0.7 ? 2 : 1;
      if (mvNow.type === 'slash') lean = Math.round(5 * ease(clamp01((p - 0.15) / 0.3))) - Math.round(5 * clamp01((p - 0.7) / 0.3));
    }
    if (defending && p > 0.5 && p < 0.9) {
      hurt = (p - 0.5) / 0.4;
      lean = -Math.round(3 * Math.sin(hurt * Math.PI));
    }
    const pos = fighter(ctx, s.x, GROUND - 22, s.dir, s.P, s.skin, { lean: attacking ? lean : lean, hurt, bob, arm, demon: s.demon });
    s.hand = pos;
    s.y = GROUND - 22;
    if (attacking && s.sword && mvNow.type !== 'throw') {
      sword(ctx, pos.handX, pos.handY, s.dir, 10, s.P, arm === 2 ? (p < 0.45 ? 1 : -1) : 1);
    } else if (attacking && s.sword && mvNow.type === 'throw' && p < 0.2) {
      sword(ctx, pos.handX, pos.handY, s.dir, 10, s.P, 1);
    } else if (!attacking && s.sword) {
      sword(ctx, pos.handX - s.dir * 2, pos.handY + 3, s.dir, 8, s.P, 1);
    }
    if (!attacking && mvNow.type === 'throw' && !s.sword) {
      // ma tu cầm hạt ma khí nhỏ khi nghỉ
      px(ctx, s.P.glow, pos.handX + s.dir * 2, pos.handY - 2, 2, 2);
    }
    if (attacking && mvNow.type === 'throw' && !s.sword && p < 0.25) px(ctx, s.P.glow, pos.handX + s.dir * 2, pos.handY - 3, 4, 4);
    fx.push(s);
  });
  const atk = fx[mvNow.who];
  const def = fx[1 - mvNow.who];
  effect(ctx, mvNow, p, { x: atk.x, y: atk.y, sword: atk.sword }, def, atk.P, seed + Math.floor(t / 90));

  // kết thúc: mờ dần ở 300ms cuối
  if (t > SCENE_MS - 300) {
    ctx.globalAlpha = 1;
  }
  return true;
}
