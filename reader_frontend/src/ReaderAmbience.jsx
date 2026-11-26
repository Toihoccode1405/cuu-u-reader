import { useEffect, useRef, useState } from 'react';
import { W, H, SCENE_MS, planScene, drawFrame } from './pixelFight.js';

const WIDE = '(min-width: 1100px)';
const PHONE = '(max-width: 640px)';

export function useMedia(query) {
  const [m, setM] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

// Mặc định: bật trên máy tính/máy tính bảng, tắt trên điện thoại; người dùng bật tắt thì theo lựa chọn đó
export function useAmbienceOn(setting) {
  const phone = useMedia(PHONE);
  return setting === undefined || setting === null ? !phone : !!setting;
}

// Nhân vật Vương Lâm đứng ở lề trái, ngoài thẻ chữ (chỉ khi màn đủ rộng để có lề)
export function AmbienceFigure() {
  const wide = useMedia(WIDE);
  if (!wide) return null;
  return <div className="ambience-figure" data-testid="ambience-figure" aria-hidden="true" />;
}

// Màn hẹp: dải ảnh mờ dần ở đầu chương, chữ vẫn nằm trên thẻ nền đặc
export function AmbienceBanner() {
  const wide = useMedia(WIDE);
  if (wide) return null;
  return <div className="ambience-banner" data-testid="ambience-banner" aria-hidden="true" />;
}

// Hai tu sĩ pixel đánh nhau ở lề phải khi chuột chỉ vào đoạn chữ. Không gọi API, không đổi state của ứng dụng.
export function PixelFight() {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return undefined;
    const ctx = cv.getContext('2d');
    const wideMq = window.matchMedia(WIDE);
    const calmMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    let fighting = false;
    let lastPara = null;
    let scenes = 0;
    cv.dataset.state = 'idle';
    cv.dataset.scenes = '0';

    const stop = () => {
      cancelAnimationFrame(raf);
      fighting = false;
      cv.classList.remove('active');
      cv.dataset.state = 'idle';
      ctx.clearRect(0, 0, W, H);
    };

    const start = (clientY) => {
      const avail = (window.innerWidth - 760) / 2 - 32;
      const scale = Math.max(1, Math.min(3, Math.floor(avail / W)));
      const h = H * scale;
      cv.style.width = `${W * scale}px`;
      cv.style.top = `${Math.round(Math.max(8, Math.min(window.innerHeight - h - 8, clientY - h / 2)))}px`;
      const scene = planScene();
      const seed = 1 + Math.floor(Math.random() * 1000);
      scenes += 1;
      cv.dataset.scenes = String(scenes);
      cv.dataset.state = 'fighting';
      cv.classList.add('active');
      fighting = true;
      const t0 = performance.now();
      const tick = (now) => {
        if (!fighting) return;
        if (!drawFrame(ctx, scene, now - t0, seed)) { stop(); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    const onMove = (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const p = e.target && e.target.closest ? e.target.closest('.reader-body [data-p]') : null;
      if (!p) { lastPara = null; return; }
      if (p === lastPara) return;
      lastPara = p;
      if (fighting || document.hidden || calmMq.matches || !wideMq.matches) return;
      start(e.clientY);
    };
    const onVisibility = () => { if (document.hidden && fighting) stop(); };

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={ref} className="pixel-fight" data-testid="pixel-fight" width={W} height={H} aria-hidden="true" data-max-ms={SCENE_MS} />;
}
