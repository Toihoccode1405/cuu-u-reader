import React from 'react';
import './icons.css';

/*
 * Bộ icon tiên hiệp vẽ tay bằng SVG path (không phụ thuộc thư viện ngoài).
 * Dùng: <XhIcon name="sword" /> hoặc <XhIcon name="sabre" className="..." />
 */
const PATHS = {
  // Kiếm dài (bội kiếm tiên gia)
  sword: (
    <>
      <path d="M14.5 2.5 21 9l-8.2 8.2-1.4-1.4L18.2 9 11.8 2.6z" />
      <path d="M11.4 15.8 8.2 12.6" />
      <path d="M8.9 11.9 4.4 16.4l3.2 3.2 4.5-4.5" />
      <path d="M3.6 20.4l1.2-1.2" />
    </>
  ),
  // Đao (đại đao cong)
  sabre: (
    <>
      <path d="M20.5 3c-3.2.4-7 2.2-9.6 4.8-2 2-3.6 4.7-4.2 7.2" />
      <path d="M20.5 3c.6 2-.3 5.3-2 7.6-1.4 1.9-3.3 3.4-5.3 4.3" />
      <path d="M7.4 14.4l2.2 2.2" />
      <path d="M4.6 17.2c1.3-.4 2.6.2 3 1.4.4 1.2-.2 2.4-1.4 2.9" />
    </>
  ),
  // Quyển trục (thư quyển)
  scroll: (
    <>
      <path d="M6.5 4.5h11a2 2 0 0 1 2 2v11a2 2 0 0 0 2 2H8a2 2 0 0 1-2-2z" />
      <path d="M6.5 4.5a2 2 0 0 0-2 2v1.2a2 2 0 0 0 2 2" />
      <path d="M10 9.5h7M10 12.5h7M10 15.5h4" />
    </>
  ),
  // Đỉnh hương (đan đỉnh)
  censer: (
    <>
      <path d="M6 9h12l-1.2 4.2A3.6 3.6 0 0 1 13.3 16h-2.6a3.6 3.6 0 0 1-3.5-2.8z" />
      <path d="M12 16v3" />
      <path d="M8.5 21h7" />
      <path d="M9 6c0-1.2 1.3-2 3-2s3 .8 3 2" />
      <path d="M12 2.2v1.2" />
    </>
  ),
  // Tháp cổ (tháp trấn yêu)
  pagoda: (
    <>
      <path d="M12 2.5 15 6H9z" />
      <path d="M7.5 6h9l1 3h-11z" />
      <path d="M6 9h12l1 3.2H5z" />
      <path d="M11 12.2V21M13 12.2V21" />
      <path d="M8.5 21h7" />
    </>
  ),
  // Trăng non + mây
  moon: (
    <>
      <path d="M15.5 3.2a8.4 8.4 0 1 0 5.3 12 9 9 0 0 1-5.3-12z" />
      <path d="M4 17.5h6M6.5 20.5h5" />
    </>
  ),
  // Đám mây tiên
  cloud: (
    <>
      <path d="M7 15.5h9.2a3.3 3.3 0 0 0 .3-6.6 4.6 4.6 0 0 0-8.8 1.1A2.8 2.8 0 0 0 7 15.5z" />
      <path d="M8.5 19h7" />
    </>
  ),
  // Hoa sen
  lotus: (
    <>
      <path d="M12 3.5c1.9 2 2.8 4 2.8 6a5.4 5.4 0 0 1-.7 2.6c-1.4-.6-2.3-2-2.3-3.6 0-1.8.1-3.4.2-5z" />
      <path d="M12 12.1c2.9 0 5.4 1.6 6.4 4-1.2 1.3-3.2 2-5.4 2H11c-2.2 0-4.2-.7-5.4-2 1-2.4 3.5-4 6.4-4z" />
      <path d="M5.6 16.1c-1.2-.6-2.1-1.6-2.6-2.8 1.3-1.3 3-2 4.7-2" />
      <path d="M18.4 16.1c1.2-.6 2.1-1.6 2.6-2.8-1.3-1.3-3-2-4.7-2" />
    </>
  ),
  // Ấn triện (pháp ấn)
  seal: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8.4 8.6h7.2M8.4 12h7.2M8.4 15.4h4.6" />
    </>
  ),
  // Hồ lô tửu (linh dược)
  gourd: (
    <>
      <path d="M12 2.6c-1.3 0-2 .9-2 2 0 1 .5 1.6.5 2.6-.9.7-1.6 1.4-2.3 2.5-.7 1.1-1.1 2.4-1.1 3.8A6 6 0 0 0 12 21.3a6 6 0 0 0 4.9-9.6c-.7-1-1.4-1.8-2.3-2.5 0-1 .5-1.6.5-2.6 0-1.1-.7-2-2-2z" />
      <path d="M9.6 12.5h4.8" />
    </>
  ),
  // Phù lục (bùa chú)
  talisman: (
    <>
      <path d="M6 3.5h12v17l-6-3.2-6 3.2z" />
      <path d="M12 7.5v6M9.5 10.5h5" />
    </>
  ),
  // Ngọc bội (bội ngọc)
  jade: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 4v4.8M12 15.2V20M4 12h4.8M15.2 12H20" />
    </>
  ),
  // Kiếm khí (kiếm quang xoáy)
  swordqi: (
    <>
      <path d="M12 3.4 18.6 10 12 16.6 5.4 10z" />
      <path d="M12 6.8 15.2 10 12 13.2 8.8 10z" />
      <path d="M12 16.6v4" />
    </>
  ),
  // Cờ hiệu môn phái
  banner: (
    <>
      <path d="M6 3.2v17.6" />
      <path d="M6 4.4h11l-2.4 3.6L17 11.6H6z" />
    </>
  ),
  // Ngọn núi tu tiên
  mountain: (
    <>
      <path d="M2.8 19.4 9.4 8.2l3.3 5.4 1.6-2.6 4.9 8.4z" />
      <path d="M12.5 4.2l1.5 2.4" />
    </>
  ),
  // Nút thắt / dây cổ (ornament nhỏ)
  knot: (
    <>
      <path d="M12 4.5 15.2 8 12 11.5 8.8 8z" />
      <path d="M12 12.5 15.2 16 12 19.5 8.8 16z" />
    </>
  )
};

export function XhIcon({ name, className = '', style }) {
  const path = PATHS[name] || PATHS.knot;
  return (
    <svg
      className={`xh-icon ${className}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      {path}
    </svg>
  );
}

/* Sprite ẩn: nhúng 1 lần để có thể dùng cả qua <use href="#xh-..."> */
export function XhSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        {Object.entries(PATHS).map(([name, path]) => (
          <symbol id={`xh-${name}`} key={name} viewBox="0 0 24 24">
            {path}
          </symbol>
        ))}
      </defs>
    </svg>
  );
}

export default XhIcon;
