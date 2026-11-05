import React, { useEffect, useState } from 'react';

// Ảnh cần đăng nhập: tải qua fetch kèm header Authorization rồi hiển thị bằng blob URL,
// để token không phải nằm trên URL (tránh lộ qua log máy chủ, lịch sử trình duyệt, referrer).
const blobCache = new Map(); // url -> blob URL

export function clearAuthImageCache() {
  for (const objectUrl of blobCache.values()) URL.revokeObjectURL(objectUrl);
  blobCache.clear();
}

export default function AuthImage({ src, token, alt, className, onError }) {
  const [objectUrl, setObjectUrl] = useState(() => blobCache.get(src) || '');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src || !token) return undefined;
    const cached = blobCache.get(src);
    if (cached) {
      setObjectUrl(cached);
      return undefined;
    }
    const controller = new AbortController();
    setFailed(false);
    fetch(src, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('cover');
        return res.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        blobCache.set(src, url);
        setObjectUrl(url);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setFailed(true);
      });
    return () => controller.abort();
  }, [src, token]);

  if (failed || !objectUrl) return null;
  return (
    <img
      src={objectUrl}
      alt={alt}
      className={className}
      referrerPolicy="no-referrer"
      onError={onError}
    />
  );
}
