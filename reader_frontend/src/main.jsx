import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service Worker (offline): chỉ đăng ký khi chạy bản build, không đăng ký khi chạy vite dev
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        // Tài nguyên đã tải trước khi Service Worker kiểm soát trang: lưu lại cho lần mở offline
        const urls = performance.getEntriesByType('resource').map((e) => e.name);
        if (reg.active) reg.active.postMessage({ type: 'cache-shell', urls });
        // Yêu cầu /me lúc khởi động đi trước khi Service Worker kiểm soát trang: gọi lại để được lưu
        fetch('/api/auth/me').catch(() => {});
      })
      .catch((e) => console.warn('Service Worker không đăng ký được:', e));
  });
}
