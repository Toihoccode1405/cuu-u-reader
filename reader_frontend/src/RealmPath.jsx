import { useEffect } from 'react';
import { REALMS, BUOC_NAMES } from '../../shared/cultivation.js';
import RealmIcon from './RealmIcon';

const BUOC_LABEL = { 1: 'Bước thứ nhất', 2: 'Bước thứ hai', 3: 'Bước thứ ba', 4: 'Bước thứ tư' };
const fmt = (n) => n.toLocaleString('vi-VN');

// Bảng "Con đường tu luyện": cả 20 cảnh giới, đánh dấu bậc đang ở và bậc đã qua
export default function RealmPath({ cultivation, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const currentIndex = REALMS.findIndex((r) => r.name === cultivation.realm.name);

  return (
    <div className="realm-path-overlay" onClick={onClose}>
      <div
        className="realm-path"
        role="dialog"
        aria-modal="true"
        aria-label="Con đường tu luyện"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="realm-path-head">
          <h3>Con đường tu luyện</h3>
          <button type="button" className="realm-path-close" onClick={onClose}>Đóng</button>
        </div>
        <div className="realm-path-total">Tu vi hiện tại: {fmt(cultivation.tu_vi)} từ đã đọc</div>

        {REALMS.map((r, i) => (
          <div key={r.name}>
            {(i === 0 || REALMS[i - 1].buoc !== r.buoc) && (
              <div className={`realm-path-buoc buoc-${r.buoc}`}>
                {BUOC_LABEL[r.buoc]} · {BUOC_NAMES[r.buoc]}
              </div>
            )}
            <div
              className={`realm-row buoc-${r.buoc} ${i < currentIndex ? 'done' : ''} ${i === currentIndex ? 'current' : ''}`}
              data-testid="realm-row"
              aria-current={i === currentIndex ? 'true' : undefined}
            >
              <RealmIcon name={r.name} size={24} />
              <span className="realm-row-name">
                {r.name}
                {r.alias && <small>({r.alias})</small>}
                {r.quaDo && !r.alias && <small>Quá độ</small>}
                {r.titles && <small>{r.titles.join(' · ')}</small>}
              </span>
              <span className="realm-row-at">từ {fmt(r.from)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
