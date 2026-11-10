// Icon SVG động cho từng cảnh giới (bộ riêng của dự án, nguồn: docs/brand/realms_full.html).
// Mỗi icon tự mang màu; thuộc tính color chỉ dùng cho ánh sáng "thở" (drop-shadow currentColor).
import ICONS from './realmIconData.js';

export const REALM_ICON_NAMES = Object.keys(ICONS);

export default function RealmIcon({ name, size = 18 }) {
  const icon = ICONS[name];
  return (
    <svg
      className="realm-svg"
      data-icon={name}
      data-fallback={icon ? undefined : 'true'}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ color: icon ? icon.color : 'currentColor' }}
      aria-hidden="true"
      focusable="false"
      // Nội dung SVG là dữ liệu tĩnh sinh lúc build từ file nguồn của dự án, không phải dữ liệu người dùng
      dangerouslySetInnerHTML={{ __html: icon ? icon.body : '<circle cx="50" cy="50" r="30" fill="currentColor"/>' }}
    />
  );
}
