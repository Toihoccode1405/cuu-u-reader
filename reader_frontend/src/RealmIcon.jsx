// Icon cho từng cảnh giới, lấy từ bộ game-icons.net (CC BY 3.0, xem docs/CREDITS.md).
// Một màu theo currentColor; màu do cha quyết định (theo Bước), nên đổi được cùng giao diện sáng/tối.
import ICONS from './realmIconData.js';

export const REALM_ICON_NAMES = Object.keys(ICONS);

export default function RealmIcon({ name, size = 18 }) {
  const icon = ICONS[name];
  return (
    <svg
      data-icon={name}
      data-fallback={icon ? undefined : 'true'}
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      // Nội dung SVG là dữ liệu tĩnh sinh lúc build từ gói icon, không phải dữ liệu người dùng
      dangerouslySetInnerHTML={{ __html: icon ? icon.body : '<circle cx="256" cy="256" r="160"/>' }}
    />
  );
}
