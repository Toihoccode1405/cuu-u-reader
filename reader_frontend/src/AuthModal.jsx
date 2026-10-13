import React, { useState } from 'react';
import { Lock, KeyRound, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { getRandomBytes, bufToBase64, createPasswordVerifier, verifyPassword, deriveKeyFromPassword } from './crypto';
import { saveAuthConfig } from './storage';

export default function AuthModal({ authConfig, onUnlock, onClose, isForceLock }) {
  const isSetupMode = !authConfig; // If no auth config in DB yet, user sets up password
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberSession, setRememberSession] = useState(true);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 4) {
      setError('Mật mã bảo mật cần ít nhất 4 ký tự!');
      return;
    }

    setLoading(true);

    try {
      if (isSetupMode) {
        // Setup new password
        if (password !== confirmPassword) {
          setError('Mật mã xác nhận không trùng khớp!');
          setLoading(false);
          return;
        }

        const saltBytes = getRandomBytes(16);
        const saltBase64 = bufToBase64(saltBytes);
        const verifierBase64 = await createPasswordVerifier(password, saltBase64);

        await saveAuthConfig(saltBase64, verifierBase64);
        const cryptoKey = await deriveKeyFromPassword(password, saltBase64);

        if (rememberSession) {
          sessionStorage.setItem('cuu_u_vault_unlocked', '1');
        }

        onUnlock(cryptoKey, { salt: saltBase64, verifier: verifierBase64 });
      } else {
        // Login / Unlock with existing password
        const isValid = await verifyPassword(password, authConfig.salt, authConfig.verifier);
        if (!isValid) {
          setError('Mật mã không chính xác! Vui lòng thử lại.');
          setLoading(false);
          return;
        }

        const cryptoKey = await deriveKeyFromPassword(password, authConfig.salt);

        if (rememberSession) {
          sessionStorage.setItem('cuu_u_vault_unlocked', '1');
        }

        onUnlock(cryptoKey, authConfig);
      }
    } catch (err) {
      setError('Lỗi xác thực: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay">
      <div className="auth-card">
        <div className="auth-icon-wrapper">
          {isSetupMode ? <ShieldCheck size={36} color="var(--accent-color)" /> : <Lock size={36} color="var(--accent-color)" />}
        </div>

        <h2 className="auth-title">
          {isSetupMode ? 'Thiết Lập Mật Mã Kho Sách' : 'Mở Khóa Tủ Sách Cá Nhân'}
        </h2>
        <p className="auth-subtitle">
          {isSetupMode
            ? 'Tạo mật mã riêng để mã hóa toàn bộ sách EPUB và bảo vệ tiến độ đọc khỏi người ngoài.'
            : 'Kho sách được mã hóa bằng thuật toán AES-256. Nhập mật mã để mở khóa.'}
        </p>

        {error && <div className="auth-error-box">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="input-group">
            <label className="input-label">Mật mã bảo vệ</label>
            <div className="password-input-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                className="auth-input"
                placeholder="Nhập mật mã của bạn..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
              />
              <button
                type="button"
                className="toggle-eye-btn"
                onClick={() => setShowPassword(!showPassword)}
                title="Hiện/Ẩn mật mã"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {isSetupMode && (
            <div className="input-group">
              <label className="input-label">Xác nhận lại mật mã</label>
              <input
                type={showPassword ? 'text' : 'password'}
                className="auth-input"
                placeholder="Nhập lại mật mã..."
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
          )}

          <div className="auth-checkbox-row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={rememberSession}
                onChange={(e) => setRememberSession(e.target.checked)}
              />
              <span>Ghi nhớ phiên đăng nhập trên thiết bị này</span>
            </label>
          </div>

          <button type="submit" className="btn btn-primary auth-submit-btn" disabled={loading}>
            <KeyRound size={18} />
            {loading ? 'Đang xác thực...' : (isSetupMode ? 'Kích Hoạt Bảo Vệ' : 'Mở Khóa Ngay')}
          </button>
        </form>

        {!isForceLock && onClose && (
          <button type="button" className="auth-cancel-btn" onClick={onClose}>
            Đóng
          </button>
        )}
      </div>
    </div>
  );
}
