import React, { useState } from 'react';
import { Cloud, KeyRound, User, LogOut, CheckCircle2, Globe, X } from 'lucide-react';

export default function CloudModal({
  cloudUser,
  cloudApiUrl,
  onLoginSuccess,
  onLogout,
  onClose,
  onUpdateApiUrl
}) {
  const [tab, setTab] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiUrl, setApiUrl] = useState(cloudApiUrl || '');
  const [showConfig, setShowConfig] = useState(!cloudApiUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const targetUrl = (apiUrl || '').trim().replace(/\/+$/, '');
    if (!targetUrl && !window.location.origin.includes('localhost')) {
      setError('Vui lòng điền địa chỉ Cloudflare Worker API của bạn.');
      setShowConfig(true);
      return;
    }

    if (!username.trim() || !password) {
      setError('Vui lòng điền đầy đủ tài khoản và mật khẩu.');
      return;
    }

    setLoading(true);
    const endpoint = tab === 'login' ? '/api/auth/login' : '/api/auth/register';
    const fullUrl = `${targetUrl}${endpoint}`;

    try {
      const res = await fetch(fullUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Xác thực không thành công');
      }

      onLoginSuccess(data.token, data.user, targetUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay">
      <div className="auth-card" style={{ maxWidth: '460px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '1.2rem' }}>
            <Cloud size={24} style={{ color: 'var(--accent-color)' }} />
            <span>Đồng Bộ Tài Khoản Đám Mây</span>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>

        {cloudUser ? (
          /* Đã đăng nhập */
          <div style={{ padding: '1.5rem 0', textAlign: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              backgroundColor: 'var(--accent-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1rem', color: 'var(--accent-color)'
            }}>
              <CheckCircle2 size={32} />
            </div>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '0.25rem' }}>Xin chào, {cloudUser.username}!</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Tài khoản đang được đồng bộ tự động giữa PC và Điện thoại qua Cloudflare.
            </p>
            <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={onLogout}>
              <LogOut size={16} /> Đăng Xuất Tài Khoản
            </button>
          </div>
        ) : (
          /* Form Đăng nhập / Đăng ký */
          <>
            <p className="auth-subtitle" style={{ textAlign: 'left', marginBottom: '1.25rem' }}>
              Đăng nhập tài khoản để tự động đồng bộ kho sách EPUB và chương đang đọc dở trên mọi thiết bị (PC, iPhone, Android).
            </p>

            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '1.25rem' }}>
              <button
                type="button"
                className={`btn ${tab === 'login' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, borderRadius: '8px 8px 0 0', border: 'none' }}
                onClick={() => { setTab('login'); setError(''); }}
              >
                Đăng Nhập
              </button>
              <button
                type="button"
                className={`btn ${tab === 'register' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, borderRadius: '8px 8px 0 0', border: 'none' }}
                onClick={() => { setTab('register'); setError(''); }}
              >
                Tạo Tài Khoản Mới
              </button>
            </div>

            {error && <div className="auth-error-box">{error}</div>}

            <form onSubmit={handleSubmit} className="auth-form">
              <div className="input-group">
                <label className="input-label">Tên tài khoản</label>
                <div className="password-input-wrapper">
                  <input
                    type="text"
                    className="auth-input"
                    placeholder="Nhập tên tài khoản của bạn..."
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                  <span style={{ position: 'absolute', right: '0.85rem', color: 'var(--text-secondary)' }}>
                    <User size={18} />
                  </span>
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">Mật khẩu</label>
                <div className="password-input-wrapper">
                  <input
                    type="password"
                    className="auth-input"
                    placeholder="Nhập mật khẩu..."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <span style={{ position: 'absolute', right: '0.85rem', color: 'var(--text-secondary)' }}>
                    <KeyRound size={18} />
                  </span>
                </div>
              </div>

              {/* Tùy chỉnh URL Cloudflare Worker */}
              <div style={{ marginTop: '0.25rem' }}>
                <div 
                  style={{ fontSize: '0.82rem', color: 'var(--accent-color)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => setShowConfig(!showConfig)}
                >
                  <Globe size={13} /> {showConfig ? 'Ẩn địa chỉ Cloudflare API' : 'Cấu hình địa chỉ Cloudflare API'}
                </div>
                {showConfig && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <input
                      type="text"
                      className="auth-input"
                      style={{ fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}
                      placeholder="https://cuu-u-reader-api.<subdomain>.workers.dev"
                      value={apiUrl}
                      onChange={(e) => setApiUrl(e.target.value)}
                    />
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                      Điền URL Cloudflare Worker của bạn (được cấp miễn phí khi deploy).
                    </div>
                  </div>
                )}
              </div>

              <button type="submit" className="btn btn-primary auth-submit-btn" disabled={loading} style={{ marginTop: '0.75rem' }}>
                <Cloud size={18} />
                {loading ? 'Đang kết nối...' : (tab === 'login' ? 'Đăng Nhập & Đồng Bộ' : 'Tạo Tài Khoản & Bắt Đầu')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
