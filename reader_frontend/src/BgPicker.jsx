import { useRef, useState } from 'react';
import { saveBgImage, removeBgImage, useBgImage } from './bgImage';

// Mục "Ảnh nền" trong cài đặt đọc: xem trước, chọn ảnh từ máy, quay về ảnh Vương Lâm, chỉnh độ mờ lớp phủ
export default function BgPicker({ dim, onDim }) {
  const { status, url, slot } = useBgImage(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      await saveBgImage(slot, file);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-picker">
      <div className="settings-label">Ảnh nền {slot === 'phone' ? 'điện thoại' : 'máy tính'} (chỉ lưu trên máy này)</div>
      <div
        className={`bg-preview ${status === 'default' ? 'is-default' : ''}`}
        style={status === 'custom' ? { backgroundImage: `url("${url}")` } : status === 'loading' ? { backgroundImage: 'none' } : undefined}
        aria-hidden="true"
      />
      <div className="bg-picker-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Đang xử lý…' : 'Chọn ảnh từ máy'}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="Chọn ảnh từ máy"
          hidden
          onChange={onFile}
        />
        {status === 'custom' && (
          <button type="button" className="btn" onClick={() => removeBgImage(slot)}>Dùng lại ảnh Vương Lâm</button>
        )}
      </div>
      {error && <div role="alert" className="bg-picker-error">{error}</div>}
      <div className="settings-label">Độ mờ ảnh: {dim}%</div>
      <input
        type="range"
        aria-label="Độ mờ ảnh"
        min="0"
        max="90"
        step="5"
        value={dim}
        onChange={(e) => onDim(Number(e.target.value))}
      />
    </div>
  );
}
