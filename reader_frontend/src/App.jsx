import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  BookOpen, Search, Plus, Trash2, ArrowLeft, ArrowRight,
  List, Sliders, Maximize, Minimize, X, History,
  PlayCircle, User, LogOut, UploadCloud
} from 'lucide-react';
import AuthPage from './AuthPage';

export default function App() {
  // Cloud Auth State
  const [cloudToken, setCloudToken] = useState(() => localStorage.getItem('cuu_u_cloud_token') || '');
  const [cloudUser, setCloudUser] = useState(() => {
    try {
      const u = localStorage.getItem('cuu_u_cloud_user');
      return u ? JSON.parse(u) : null;
    } catch (e) { return null; }
  });

  // View routing: if not logged in -> 'auth' is the index page!
  const [view, setView] = useState(() => (localStorage.getItem('cuu_u_cloud_token') ? 'library' : 'auth'));

  // Library & History Data
  const [books, setBooks] = useState([]);
  const [history, setHistory] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  // Active Reading State
  const [currentBook, setCurrentBook] = useState(null);
  const [currentChapter, setCurrentChapter] = useState(null);
  const [chapterIndex, setChapterIndex] = useState(1);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [headerVisible, setHeaderVisible] = useState(true);

  // Drawers & Settings
  const [showTOC, setShowTOC] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tocSearch, setTocSearch] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('cuu_u_reader_settings');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return {
      theme: 'sepia',
      font: 'font-literata',
      fontSize: 19,
      lineHeight: 1.8,
      maxWidth: 780,
      justify: true
    };
  });

  const lastScrollTopRef = useRef(0);
  const scrollTimeoutRef = useRef(null);
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);

  const showToast = useCallback((msg, ms = 3000) => {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  }, []);

  // Sync settings with DOM & localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.documentElement.style.setProperty('--reader-font-size', `${settings.fontSize}px`);
    document.documentElement.style.setProperty('--reader-line-height', settings.lineHeight);
    document.documentElement.style.setProperty('--reader-max-width', `${settings.maxWidth}px`);
    localStorage.setItem('cuu_u_reader_settings', JSON.stringify(settings));
  }, [settings]);

  // ---------------------------------------------------------------------------
  // DATA LOADING (AUTO SYNC FROM CLOUDFLARE D1)
  // ---------------------------------------------------------------------------

  const loadUserData = useCallback(async (token) => {
    if (!token) return;
    setLoading(true);
    try {
      const headers = { 'Authorization': `Bearer ${token}` };

      // 1. Fetch Books
      const booksRes = await fetch('/api/books', { headers });
      if (booksRes.status === 401) {
        handleLogout();
        return;
      }
      if (booksRes.ok) {
        const booksData = await booksRes.json();
        setBooks(booksData);
      }

      // 2. Fetch Multi-Book Reading History
      const histRes = await fetch('/api/history', { headers });
      if (histRes.ok) {
        const histData = await histRes.json();
        setHistory(histData);
      }
    } catch (e) {
      showToast('Lỗi kết nối máy chủ Cloudflare');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // Auto load on startup if logged in
  useEffect(() => {
    if (cloudToken) {
      loadUserData(cloudToken);
    }
  }, [cloudToken, loadUserData]);

  // Auto re-sync when tab gains focus (e.g., switched from phone to PC)
  useEffect(() => {
    const handleFocus = () => {
      if (cloudToken && view === 'library') {
        loadUserData(cloudToken);
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [cloudToken, view, loadUserData]);

  // ---------------------------------------------------------------------------
  // AUTHENTICATION HANDLERS
  // ---------------------------------------------------------------------------

  const handleLoginSuccess = (token, user) => {
    localStorage.setItem('cuu_u_cloud_token', token);
    localStorage.setItem('cuu_u_cloud_user', JSON.stringify(user));
    setCloudToken(token);
    setCloudUser(user);
    setView('library');
    showToast(`Chào mừng ${user.username}!`);
    loadUserData(token);
  };

  const handleLogout = () => {
    localStorage.removeItem('cuu_u_cloud_token');
    localStorage.removeItem('cuu_u_cloud_user');
    setCloudToken('');
    setCloudUser(null);
    setBooks([]);
    setHistory([]);
    setCurrentBook(null);
    setCurrentChapter(null);
    setView('auth');
    showToast('Đã đăng xuất.');
  };

  // ---------------------------------------------------------------------------
  // BOOK MANAGEMENT (UPLOAD & DELETE)
  // ---------------------------------------------------------------------------

  const handleUpload = async (file) => {
    if (!file || !file.name.toLowerCase().endsWith('.epub')) {
      showToast('Vui lòng chọn file định dạng .epub');
      return;
    }

    showToast(`Đang tải sách lên Cloudflare D1: ${file.name}...`);
    setLoading(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/books/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cloudToken}` },
        body: formData
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText);
      }

      const newBook = await res.json();
      showToast(`Đã thêm thành công: ${newBook.title}!`);
      await loadUserData(cloudToken);
    } catch (e) {
      alert(`Lỗi tải sách: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBook = async (book, e) => {
    e.stopPropagation();
    if (window.confirm(`Bạn có chắc muốn xóa "${book.title}" khỏi thư các?`)) {
      try {
        const res = await fetch(`/api/books/${book.id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${cloudToken}` }
        });
        if (res.ok) {
          showToast(`Đã xóa: ${book.title}`);
          await loadUserData(cloudToken);
        }
      } catch (e) {
        showToast('Lỗi khi xóa sách');
      }
    }
  };

  // ---------------------------------------------------------------------------
  // READER ENGINE & AUTO PROGRESS SYNC
  // ---------------------------------------------------------------------------

  const openBook = async (bookId, targetChapter = 1, restoreScroll = 0) => {
    showToast('Đang mở sách...');
    setLoading(true);

    try {
      const res = await fetch(`/api/books/${bookId}`, {
        headers: { 'Authorization': `Bearer ${cloudToken}` }
      });
      if (!res.ok) throw new Error('Không thể tải thông tin sách.');
      const bookData = await res.json();

      setCurrentBook(bookData);
      setChapterIndex(targetChapter);
      setView('reader');
      window.scrollTo({ top: 0, behavior: 'instant' });

      await loadChapter(bookId, targetChapter, restoreScroll || bookData.record.scroll_percent);
    } catch (e) {
      showToast(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadChapter = async (bookId, idx, restoreScroll = 0) => {
    try {
      const res = await fetch(`/api/books/${bookId}/chapters/${idx}`, {
        headers: { 'Authorization': `Bearer ${cloudToken}` }
      });
      if (!res.ok) throw new Error('Không thể tải nội dung chương.');
      const data = await res.json();

      setCurrentChapter(data);
      setChapterIndex(idx);
      window.scrollTo({ top: 0, behavior: 'instant' });

      if (restoreScroll > 0) {
        setTimeout(() => {
          const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
          window.scrollTo({ top: maxScroll * (restoreScroll / 100), behavior: 'smooth' });
        }, 120);
      }

      saveProgressToCloud(bookId, data.title, idx, restoreScroll);
    } catch (e) {
      showToast(e.message);
    }
  };

  const saveProgressToCloud = async (bookId, chTitle, idx, scrollPct) => {
    if (!cloudToken || !bookId) return;
    try {
      const bTitle = currentBook?.record?.title || currentBook?.title || 'Sách';
      await fetch(`/api/books/${bookId}/progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cloudToken}`
        },
        body: JSON.stringify({
          chapter_index: idx,
          chapter_title: chTitle,
          scroll_percent: scrollPct,
          book_title: bTitle
        })
      });

      // Update history in local state for instant responsiveness
      setHistory(prev => {
        const remaining = prev.filter(h => h.book_id !== bookId);
        return [{
          book_id: bookId,
          book_title: bTitle,
          chapter_index: idx,
          chapter_title: chTitle,
          scroll_percent: scrollPct,
          author: currentBook?.record?.author || '',
          has_cover: currentBook?.record?.has_cover || false,
          updated_at: Date.now()
        }, ...remaining];
      });
    } catch (e) {}
  };

  // Debounced scroll listener for reading position sync
  useEffect(() => {
    if (view !== 'reader' || !currentBook || !currentChapter) return;

    const handleScroll = () => {
      const st = window.scrollY || document.documentElement.scrollTop;
      const sh = document.documentElement.scrollHeight - window.innerHeight;
      const pct = sh > 0 ? Math.min(100, Math.max(0, (st / sh) * 100)) : 0;
      setScrollProgress(pct);

      // Hide / show header on scroll
      if (Math.abs(st - lastScrollTopRef.current) > 25) {
        setHeaderVisible(st < lastScrollTopRef.current || st < 60);
        lastScrollTopRef.current = st;
      }

      // Debounce saving progress to cloud
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        saveProgressToCloud(
          currentBook.record ? currentBook.record.id : currentBook.id,
          currentChapter.title,
          chapterIndex,
          pct
        );
      }, 800);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeoutRef.current);
    };
  }, [view, currentBook, currentChapter, chapterIndex]);

  // Touch swipe gestures for next/prev chapter
  const handleTouchStart = (e) => {
    touchStartXRef.current = e.changedTouches[0].screenX;
    touchStartYRef.current = e.changedTouches[0].screenY;
  };

  const handleTouchEnd = (e) => {
    if (view !== 'reader') return;
    const diffX = e.changedTouches[0].screenX - touchStartXRef.current;
    const diffY = e.changedTouches[0].screenY - touchStartYRef.current;
    if (Math.abs(diffX) > 70 && Math.abs(diffY) < 50) {
      const bId = currentBook.record ? currentBook.record.id : currentBook.id;
      if (diffX < 0 && currentChapter?.next_index) {
        loadChapter(bId, currentChapter.next_index);
      } else if (diffX > 0 && currentChapter?.prev_index) {
        loadChapter(bId, currentChapter.prev_index);
      }
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // ---------------------------------------------------------------------------
  // VIEW 1: AUTH INDEX PAGE (IF NOT LOGGED IN)
  // ---------------------------------------------------------------------------

  if (view === 'auth' || !cloudToken) {
    return <AuthPage onLoginSuccess={handleLoginSuccess} />;
  }

  // ---------------------------------------------------------------------------
  // VIEW 2: LIBRARY VIEW (INDEX FOR LOGGED-IN USERS)
  // ---------------------------------------------------------------------------

  const filteredBooks = books.filter(b =>
    b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (b.author && b.author.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {view === 'library' && (
        <>
          <header className="header">
            <div className="header-inner">
              <div className="brand" onClick={() => loadUserData(cloudToken)}>
                <BookOpen size={24} style={{ color: 'var(--accent-color)' }} />
                <span>Cửu U Thư Các</span>
              </div>

              <div className="search-container">
                <Search size={18} className="search-icon" />
                <input
                  type="text"
                  className="search-input"
                  placeholder="Tìm kiếm sách, tác giả..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* User Profile Badge */}
                {cloudUser && (
                  <div className="user-badge" title="Tài khoản đang đăng nhập">
                    <User size={14} style={{ color: 'var(--accent-color)' }} />
                    <span className="hide-on-mobile">{cloudUser.username}</span>
                    <button
                      className="btn-logout-icon"
                      onClick={handleLogout}
                      title="Đăng xuất"
                    >
                      <LogOut size={14} />
                    </button>
                  </div>
                )}

                {/* Upload Book Button */}
                <label className="btn btn-primary" title="Thêm sách EPUB">
                  <Plus size={18} />
                  <span className="hide-on-mobile">Thêm Sách</span>
                  <input
                    type="file"
                    accept=".epub"
                    style={{ display: 'none' }}
                    onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
                  />
                </label>
              </div>
            </div>
          </header>

          <main className="library-wrapper">
            {/* 1. MULTI-BOOK READING HISTORY SECTION */}
            {history.length > 0 && (
              <section className="history-section">
                <div className="section-header-title">
                  <History size={20} color="var(--accent-color)" />
                  <span>Tiến Độ & Lịch Sử Đọc Gần Đây ({history.length})</span>
                </div>
                <div className="history-grid">
                  {history.map((item) => (
                    <div key={item.book_id} className="history-card">
                      {item.has_cover ? (
                        <img
                          src={`/api/books/${item.book_id}/cover`}
                          alt={item.book_title}
                          className="history-cover"
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <div className="history-cover-placeholder">
                          <BookOpen size={28} />
                        </div>
                      )}
                      <div className="history-body">
                        <div>
                          <h3 className="history-book-title" title={item.book_title}>
                            {item.book_title}
                          </h3>
                          <div className="history-chapter-info" title={item.chapter_title}>
                            {item.chapter_title || `Chương ${item.chapter_index}`}
                          </div>
                        </div>

                        <div className="history-progress-wrap">
                          <div className="history-progress-track">
                            <div
                              className="history-progress-fill"
                              style={{ width: `${Math.min(100, Math.max(3, Math.round(item.scroll_percent || 0)))}%` }}
                            />
                          </div>
                          <div className="history-footer-row">
                            <span className="history-meta-text">
                              {item.author || 'Tác giả'} • {Math.round(item.scroll_percent || 0)}%
                            </span>
                            <button
                              className="history-resume-btn"
                              onClick={() => openBook(item.book_id, item.chapter_index, item.scroll_percent)}
                            >
                              <PlayCircle size={14} />
                              <span>Đọc tiếp</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 2. FULL BOOK LIBRARY GRID */}
            <section>
              <div className="section-header-title">
                <BookOpen size={20} color="var(--accent-color)" />
                <span>Tất Cả Sách Trong Thư Các ({filteredBooks.length})</span>
              </div>

              {filteredBooks.length === 0 ? (
                <div className="empty-state">
                  <UploadCloud size={54} className="empty-icon" />
                  <h3>Thư các của bạn hiện đang trống</h3>
                  <p>Hãy tải lên file tiểu thuyết <code>.epub</code> để lưu trữ vĩnh viễn trên Cloudflare và đọc mọi lúc mọi nơi.</p>
                  <label className="btn btn-primary" style={{ marginTop: '1.25rem', cursor: 'pointer' }}>
                    <Plus size={18} />
                    <span>Tải File .EPUB Lên Ngay</span>
                    <input
                      type="file"
                      accept=".epub"
                      style={{ display: 'none' }}
                      onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
                    />
                  </label>
                </div>
              ) : (
                <div className="book-grid">
                  {filteredBooks.map((book) => (
                    <div
                      key={book.id}
                      className="book-card"
                      onClick={() => openBook(book.id, book.current_chapter || 1, book.scroll_percent || 0)}
                    >
                      <button
                        className="book-delete-btn"
                        title="Xóa sách"
                        onClick={(e) => handleDeleteBook(book, e)}
                      >
                        <Trash2 size={16} />
                      </button>

                      <div className="book-cover-container">
                        {book.has_cover ? (
                          <img
                            src={`/api/books/${book.id}/cover`}
                            alt={book.title}
                            className="book-cover-img"
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                        ) : (
                          <div className="book-cover-placeholder">
                            <BookOpen size={42} />
                          </div>
                        )}
                      </div>

                      <div className="book-info">
                        <h4 className="book-title" title={book.title}>{book.title}</h4>
                        <div className="book-author">{book.author || 'Khuyết danh'}</div>
                        <div className="book-badge">
                          {book.total_chapters} chương
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </main>
        </>
      )}

      {/* -----------------------------------------------------------------------
          VIEW 3: READER VIEW
          ----------------------------------------------------------------------- */}
      {view === 'reader' && currentBook && currentChapter && (
        <div className="reader-wrapper">
          <header className={`reader-header ${headerVisible ? '' : 'hidden'}`}>
            <div className="reader-header-inner">
              <button
                className="btn btn-icon"
                onClick={() => {
                  setView('library');
                  loadUserData(cloudToken);
                }}
                title="Quay lại Thư viện"
              >
                <ArrowLeft size={20} />
              </button>

              <div className="reader-title-truncate">
                <strong>{currentBook.record ? currentBook.record.title : currentBook.title}</strong>
                <span className="hide-on-mobile" style={{ margin: '0 8px', opacity: 0.5 }}>•</span>
                <span className="hide-on-mobile" style={{ fontSize: '0.82rem', opacity: 0.85 }}>{currentChapter.title}</span>
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-icon" onClick={() => setShowTOC(true)} title="Mục lục chương">
                  <List size={20} />
                </button>
                <button className="btn btn-icon" onClick={() => setShowSettings(true)} title="Cài đặt giao diện">
                  <Sliders size={20} />
                </button>
                <button className="btn btn-icon hide-on-mobile" onClick={toggleFullscreen} title="Toàn màn hình">
                  {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                </button>
              </div>
            </div>
          </header>

          <main className="reader-content-box">
            <h1 className="chapter-header-title">{currentChapter.title}</h1>
            <div
              className={`reader-body ${settings.font} ${settings.justify ? 'text-justify' : ''}`}
              dangerouslySetInnerHTML={{ __html: currentChapter.content_html }}
            />

            <div className="nav-bottom-bar">
              <button
                className="btn btn-secondary"
                disabled={!currentChapter.prev_index}
                onClick={() => loadChapter(currentBook.record ? currentBook.record.id : currentBook.id, currentChapter.prev_index)}
              >
                <ArrowLeft size={16} /> Chương trước
              </button>

              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Chương {chapterIndex} / {currentChapter.total_chapters}
              </span>

              <button
                className="btn btn-primary"
                disabled={!currentChapter.next_index}
                onClick={() => loadChapter(currentBook.record ? currentBook.record.id : currentBook.id, currentChapter.next_index)}
              >
                Chương tiếp theo <ArrowRight size={16} />
              </button>
            </div>
          </main>

          <footer className="reader-footer">
            <span>{currentChapter.title}</span>
            <span>{Math.round(scrollProgress)}%</span>
          </footer>

          {/* TABLE OF CONTENTS DRAWER */}
          <div className={`drawer-overlay ${showTOC ? 'open' : ''}`} onClick={() => setShowTOC(false)}>
            <div className="drawer" onClick={(e) => e.stopPropagation()}>
              <div className="drawer-header">
                <h3>Mục Lục Chương</h3>
                <button className="btn btn-icon" onClick={() => setShowTOC(false)}>
                  <X size={20} />
                </button>
              </div>
              <div style={{ padding: '0.75rem 1rem' }}>
                <input
                  type="text"
                  className="search-input"
                  style={{ width: '100%' }}
                  placeholder="Tìm kiếm tên chương..."
                  value={tocSearch}
                  onChange={(e) => setTocSearch(e.target.value)}
                />
              </div>
              <div className="toc-list">
                {(currentBook.chapters || [])
                  .filter(c => c.title.toLowerCase().includes(tocSearch.toLowerCase()))
                  .map((ch) => (
                    <div
                      key={ch.index}
                      className={`toc-item ${ch.index === chapterIndex ? 'active' : ''}`}
                      onClick={() => {
                        setShowTOC(false);
                        loadChapter(currentBook.record ? currentBook.record.id : currentBook.id, ch.index);
                      }}
                    >
                      <span>{ch.title}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* SETTINGS DRAWER */}
          <div className={`drawer-overlay ${showSettings ? 'open' : ''}`} onClick={() => setShowSettings(false)}>
            <div className="drawer" onClick={(e) => e.stopPropagation()}>
              <div className="drawer-header">
                <h3>Tùy Chỉnh Giao Diện</h3>
                <button className="btn btn-icon" onClick={() => setShowSettings(false)}>
                  <X size={20} />
                </button>
              </div>

              <div className="settings-section">
                <label className="settings-label">Màu Nền / Chủ Đề</label>
                <div className="theme-options">
                  <div
                    className={`theme-badge theme-paper ${settings.theme === 'paper' ? 'active' : ''}`}
                    onClick={() => setSettings(s => ({ ...s, theme: 'paper' }))}
                  >
                    Sáng
                  </div>
                  <div
                    className={`theme-badge theme-sepia ${settings.theme === 'sepia' ? 'active' : ''}`}
                    onClick={() => setSettings(s => ({ ...s, theme: 'sepia' }))}
                  >
                    Ấm áp
                  </div>
                  <div
                    className={`theme-badge theme-dark ${settings.theme === 'dark' ? 'active' : ''}`}
                    onClick={() => setSettings(s => ({ ...s, theme: 'dark' }))}
                  >
                    Tối
                  </div>
                  <div
                    className={`theme-badge theme-oled ${settings.theme === 'oled' ? 'active' : ''}`}
                    onClick={() => setSettings(s => ({ ...s, theme: 'oled' }))}
                  >
                    OLED
                  </div>
                </div>

                <label className="settings-label">Font Chữ</label>
                <div className="font-options">
                  {[
                    { id: 'font-literata', name: 'Literata (Sách)' },
                    { id: 'font-merriweather', name: 'Merriweather (Serif)' },
                    { id: 'font-lora', name: 'Lora (Cổ điển)' },
                    { id: 'font-be-vietnam', name: 'Be Vietnam Pro' },
                    { id: 'font-inter', name: 'Inter (Sans)' }
                  ].map(f => (
                    <div
                      key={f.id}
                      className={`font-badge ${settings.font === f.id ? 'active' : ''}`}
                      onClick={() => setSettings(s => ({ ...s, font: f.id }))}
                    >
                      {f.name}
                    </div>
                  ))}
                </div>

                <label className="settings-label">Cỡ Chữ: {settings.fontSize}px</label>
                <div className="font-size-control">
                  <button
                    className="size-btn"
                    onClick={() => setSettings(s => ({ ...s, fontSize: Math.max(14, s.fontSize - 1) }))}
                  >
                    A-
                  </button>
                  <span style={{ fontWeight: 600 }}>{settings.fontSize}px</span>
                  <button
                    className="size-btn"
                    onClick={() => setSettings(s => ({ ...s, fontSize: Math.min(32, s.fontSize + 1) }))}
                  >
                    A+
                  </button>
                </div>

                <label className="settings-label">Căn Đều 2 Bên</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    className={`theme-badge ${settings.justify ? 'active' : ''}`}
                    style={{ flex: 1, textAlign: 'center' }}
                    onClick={() => setSettings(s => ({ ...s, justify: !s.justify }))}
                  >
                    {settings.justify ? 'Đang căn đều' : 'Căn trái'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOAST POPUP */}
      <div className={`toast-msg ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
