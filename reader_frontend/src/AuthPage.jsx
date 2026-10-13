import React, { useState } from 'react';
import { BookOpen, User, Lock, ArrowRight, ShieldCheck, Cloud, Smartphone, Monitor } from 'lucide-react';
import { apiFetch } from './api';

export default function AuthPage({ onLoginSuccess }) {
  const [tab, setTab] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const cleanUser = username.trim();
    if (!cleanUser || !password) {
      setError('Vui lòng nhập đầy đủ tên tài khoản và mật khẩu.');
      return;
    }

    if (tab === 'register') {
      if (cleanUser.length < 3) {
        setError('Tên tài khoản phải từ 3 ký tự trở lên.');
        return;
      }
      if (password.length < 4) {
        setError('Mật khẩu phải từ 4 ký tự trở lên.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Mật khẩu xác nhận không khớp.');
        return;
      }
    }

    setLoading(true);
    try {
      const endpoint = tab === 'login' ? '/api/auth/login' : '/api/auth/register';
      const data = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUser, password }),
      });

      // Success
      onLoginSuccess(data.token, data.user);
    } catch (err) {
      setError(err.message || 'Lỗi kết nối máy chủ.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-index-page">
      <div className="auth-index-card">
        {/* Brand Header */}
        <div className="auth-index-brand">
          <div className="auth-brand-icon">
            <BookOpen size={36} color="var(--accent-color)" />
          </div>
          <h1 className="auth-brand-title">Cửu U Thư Các</h1>
          <p className="auth-brand-subtitle">
            Không gian đọc truyện cá nhân • Tự động ghi nhớ trang đọc
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="auth-tab-bar">
          <button
            type="button"
            className={`auth-tab-btn ${tab === 'login' ? 'active' : ''}`}
            onClick={() => { setTab('login'); setError(''); }}
          >
            Đăng Nhập
          </button>
          <button
            type="button"
            className={`auth-tab-btn ${tab === 'register' ? 'active' : ''}`}
            onClick={() => { setTab('register'); setError(''); }}
          >
            Đăng Ký Mới
          </button>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="auth-error-banner">
            {error}
          </div>
        )}

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="auth-form-body">
          <div className="auth-field-group">
            <label className="auth-field-label">Tên tài khoản</label>
            <div className="auth-input-wrapper">
              <User size={18} className="auth-input-icon" />
              <input
                type="text"
                className="auth-text-input"
                placeholder="Nhập tên tài khoản..."
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className="auth-field-group">
            <label className="auth-field-label">Mật khẩu</label>
            <div className="auth-input-wrapper">
              <Lock size={18} className="auth-input-icon" />
              <input
                type="password"
                className="auth-text-input"
                placeholder="Nhập mật khẩu..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          {tab === 'register' && (
            <div className="auth-field-group">
              <label className="auth-field-label">Xác nhận mật khẩu</label>
              <div className="auth-input-wrapper">
                <Lock size={18} className="auth-input-icon" />
                <input
                  type="password"
                  className="auth-text-input"
                  placeholder="Nhập lại mật khẩu..."
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={loading}
          >
            {loading ? (
              <span>{tab === 'login' ? 'Đang đăng nhập...' : 'Đang tạo tài khoản...'}</span>
            ) : (
              <>
                <span>{tab === 'login' ? 'Đăng Nhập Vào Thư Các' : 'Tạo Tài Khoản & Bắt Đầu'}</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        <div className="auth-footer-note">
          <ShieldCheck size={14} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
          <span>Tự động lưu trữ và đồng bộ tiến độ đọc trên mọi thiết bị.</span>
        </div>
      </div>
    </div>
  );
}
