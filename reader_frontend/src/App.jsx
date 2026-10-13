import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  BookOpen, Search, Plus, Trash2, ArrowLeft, ArrowRight,
  List, Sliders, Maximize, Minimize, X, UploadCloud, Cloud, HardDrive
} from 'lucide-react';
import {
  getAllBooksFromDB, getBookFromDB, saveBookToDB,
  deleteBookFromDB, updateProgressInDB, parseEpubClient
} from './storage';

const API_BASE = '';

export default function App() {
  const [view, setView] = useState('library');
  const [books, setBooks] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [isServerMode, setIsServerMode] = useState(false);

  // Active Reading State
  const [currentBook, setCurrentBook] = useState(null);
  const [currentChapter, setCurrentChapter] = useState(null);
  const [chapterIndex, setChapterIndex] = useState(1);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [headerVisible, setHeaderVisible] = useState(true);

  // Drawers
  const [showTOC, setShowTOC] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tocSearch, setTocSearch] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Typography Settings
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('cuu_u_reader_settings');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return {
      theme: 'sepia',
      font: 'font-literata',
      fontSize: 19,
      lineHeight: 1.75,
      maxWidth: 820,
      align: 'justify'
    };
  });

  const lastScrollTopRef = useRef(0);
  const scrollTimerRef = useRef(null);
  const touchStartXRef = useRef(0);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }, []);

  // Sync settings with DOM & localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.documentElement.style.setProperty('--reader-font-size', `${settings.fontSize}px`);
    document.documentElement.style.setProperty('--reader-line-height', settings.lineHeight);
    document.documentElement.style.setProperty('--max-content-width', `${settings.maxWidth}px`);
    localStorage.setItem('cuu_u_reader_settings', JSON.stringify(settings));
  }, [settings]);

  // Check backend server on load
  useEffect(() => {
    initApp();
  }, []);

  const initApp = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/books`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        setIsServerMode(true);
        const data = await res.json();
        setBooks(data);
        return;
      }
    } catch (e) {
      // Backend not running -> Fallback to client-side IndexedDB mode (GitHub Pages / Cloudflare Pages)
      setIsServerMode(false);
    }
    loadBooksFromIndexedDB();
  };

  const loadBooksFromIndexedDB = async () => {
    try {
      const list = await getAllBooksFromDB();
      setBooks(list);
    } catch (e) {
      showToast('Lỗi truy cập dữ liệu: ' + e.message);
    }
  };

  // Upload Handler (Dual mode: Server or Client-side IndexedDB)
  const handleUpload = async (file) => {
    if (!file || !file.name.toLowerCase().endsWith('.epub')) {
      showToast('Vui lòng chọn file định dạng .epub');
      return;
    }
    showToast(`Đang phân tích: ${file.name}...`);
    setLoading(true);

    if (isServerMode) {
      // Server upload
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await fetch(`${API_BASE}/api/books/upload`, {
          method: 'POST',
          body: formData
        });
        if (!res.ok) throw new Error(await res.text());
        const newBook = await res.json();
        showToast(`Đã thêm thành công: ${newBook.title}`);
        initApp();
      } catch (e) {
        showToast(`Thất bại: ${e.message}`);
      } finally {
        setLoading(false);
      }
    } else {
      // 100% Client-side (GitHub Pages / Cloudflare Pages)
      try {
        const bookData = await parseEpubClient(file);
        await saveBookToDB(bookData);
        showToast(`Đã lưu thành công: ${bookData.title}`);
        await loadBooksFromIndexedDB();
      } catch (e) {
        showToast(`Lỗi giải nén EPUB: ${e.message}`);
      } finally {
        setLoading(false);
      }
    }
  };

  // Delete Handler
  const handleDeleteBook = async (book, e) => {
    e.stopPropagation();
    if (window.confirm(`Bạn có chắc muốn xóa cuốn sách "${book.title}" khỏi thư viện?`)) {
      if (isServerMode) {
        try {
          const res = await fetch(`${API_BASE}/api/books/${book.id}`, { method: 'DELETE' });
          if (res.ok) {
            showToast('Đã xóa sách khỏi thư viện');
            initApp();
          }
        } catch (e) {
          showToast('Lỗi xóa sách');
        }
      } else {
        await deleteBookFromDB(book.id);
        showToast('Đã xóa sách khỏi thư viện');
        await loadBooksFromIndexedDB();
      }
    }
  };

  // Open Book
  const openBook = async (bookId, targetChapter = 1) => {
    showToast('Đang mở sách...');
    setLoading(true);

    if (isServerMode) {
      try {
        const res = await fetch(`${API_BASE}/api/books/${bookId}`);
        if (!res.ok) throw new Error('Không thể tải thông tin sách');
        const bookData = await res.json();
        setCurrentBook(bookData);
        setChapterIndex(targetChapter);
        setView('reader');
        window.scrollTo({ top: 0, behavior: 'instant' });
        await loadChapter(bookId, targetChapter, bookData.record.scroll_percent);
      } catch (e) {
        showToast(e.message);
      } finally {
        setLoading(false);
      }
    } else {
      // Client-side IndexedDB mode
      try {
        const bookData = await getBookFromDB(bookId);
        if (!bookData) throw new Error('Không tìm thấy sách trong bộ nhớ');
        setCurrentBook({ record: bookData, chapters: bookData.chapters, files: bookData.files });
        setChapterIndex(targetChapter);
        setView('reader');
        window.scrollTo({ top: 0, behavior: 'instant' });
        await loadChapterClient(bookData, targetChapter, bookData.scroll_percent);
      } catch (e) {
        showToast(e.message);
      } finally {
        setLoading(false);
      }
    }
  };

  // Load Chapter (Server mode)
  const loadChapter = async (bookId, idx, restoreScroll = 0) => {
    try {
      const res = await fetch(`${API_BASE}/api/books/${bookId}/chapters/${idx}`);
      if (!res.ok) throw new Error('Không thể tải nội dung chương');
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
      sendProgress(bookId, idx, 0);
    } catch (e) {
      showToast(e.message);
    }
  };

  // Load Chapter (Client-side IndexedDB mode)
  const loadChapterClient = (bookData, idx, restoreScroll = 0) => {
    const chapters = bookData.chapters;
    const total = chapters.len || chapters.length;
    if (idx < 1 || idx > total) return;

    const chMeta = chapters[idx - 1];
    const htmlContent = bookData.files[chMeta.href] || '<p>Không có nội dung chương.</p>';

    const chapterPayload = {
      book_id: bookData.id,
      chapter_index: idx,
      title: chMeta.title,
      content_html: htmlContent,
      total_chapters: total,
      prev_index: idx > 1 ? idx - 1 : null,
      next_index: idx < total ? idx + 1 : null
    };

    setCurrentChapter(chapterPayload);
    setChapterIndex(idx);
    window.scrollTo({ top: 0, behavior: 'instant' });

    if (restoreScroll > 0) {
      setTimeout(() => {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: maxScroll * (restoreScroll / 100), behavior: 'smooth' });
      }, 120);
    }

    updateProgressInDB(bookData.id, idx, 0);
  };

  const sendProgress = (bookId, idx, percent) => {
    if (isServerMode) {
      fetch(`${API_BASE}/api/books/${bookId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapter_index: idx, scroll_percent: percent })
      }).catch(() => {});
    } else {
      updateProgressInDB(bookId, idx, percent);
    }
  };

  const nextChapter = () => {
    if (!currentChapter?.next_index) return;
    if (isServerMode) {
      loadChapter(currentBook.record.id, currentChapter.next_index, 0);
    } else {
      loadChapterClient(currentBook.record, currentChapter.next_index, 0);
    }
  };

  const prevChapter = () => {
    if (!currentChapter?.prev_index) return;
    if (isServerMode) {
      loadChapter(currentBook.record.id, currentChapter.prev_index, 0);
    } else {
      loadChapterClient(currentBook.record, currentChapter.prev_index, 0);
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

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (view !== 'reader') return;
      if (e.key === 'ArrowRight') nextChapter();
      if (e.key === 'ArrowLeft') prevChapter();
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      if (e.key === 'Escape') {
        setShowTOC(false);
        setShowSettings(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, currentChapter]);

  // Touch Swipe on Mobile
  const handleTouchStart = (e) => {
    touchStartXRef.current = e.changedTouches[0].screenX;
  };

  const handleTouchEnd = (e) => {
    if (view !== 'reader') return;
    const diff = e.changedTouches[0].screenX - touchStartXRef.current;
    if (Math.abs(diff) > 90) {
      if (diff > 0) prevChapter();
      else nextChapter();
    }
  };

  // Scroll listener
  useEffect(() => {
    const handleScroll = () => {
      if (view !== 'reader') return;
      const st = window.pageYOffset || document.documentElement.scrollTop;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const progress = maxScroll > 0 ? (st / maxScroll) * 100 : 0;
      setScrollProgress(progress);

      if (st > lastScrollTopRef.current && st > 120) {
        setHeaderVisible(false);
      } else {
        setHeaderVisible(true);
      }
      lastScrollTopRef.current = st <= 0 ? 0 : st;

      clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        if (currentBook) {
          sendProgress(currentBook.record.id, chapterIndex, progress);
        }
      }, 1000);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [view, currentBook, chapterIndex]);

  // Filtered books
  const filteredBooks = books.filter(b =>
    b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    b.author.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      
      {/* 1. LIBRARY VIEW */}
      {view === 'library' && (
        <>
          <header className="header">
            <div className="header-inner">
              <div className="brand" onClick={() => initApp()}>
                <BookOpen size={24} style={{ color: 'var(--accent-color)' }} />
                <span>Cửu U Thư Các</span>
                <span className="badge hide-on-mobile" style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {isServerMode ? <Cloud size={12} /> : <HardDrive size={12} />}
                  {isServerMode ? 'Server Sync' : 'Offline / Pages'}
                </span>
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
              <div>
                <label className="btn btn-primary" title="Thêm sách EPUB">
                  <Plus size={18} />
                  <span className="hide-on-mobile">Thêm Sách (EPUB)</span>
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
            <div
              className="dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files?.[0]) handleUpload(e.dataTransfer.files[0]);
              }}
            >
              <UploadCloud size={40} className="dropzone-icon" />
              <div className="dropzone-title">Kéo & thả file EPUB vào đây</div>
              <div className="dropzone-desc">
                {isServerMode 
                  ? 'Đồng bộ trực tiếp lên server đám mây cá nhân'
                  : 'Lưu trữ trực tiếp và an toàn trên thiết bị (Hoạt động offline 100% không cần server)'}
              </div>
            </div>

            <div className="section-head">
              <div className="section-title">
                Tủ Sách Của Bạn <span className="badge">{filteredBooks.length}</span>
              </div>
            </div>

            {filteredBooks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
                <BookOpen size={64} style={{ opacity: 0.3, margin: '0 auto 1rem' }} />
                <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Chưa có sách trong thư viện</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                  Kéo thả file .epub vào khung phía trên để bắt đầu đọc sách!
                </p>
              </div>
            ) : (
              <div className="book-grid">
                {filteredBooks.map((book) => {
                  const percent = Math.round((book.current_chapter / Math.max(1, book.total_chapters)) * 100);
                  const coverSrc = book.cover_url || (isServerMode && book.has_cover ? `${API_BASE}/api/books/${book.id}/cover` : null);

                  return (
                    <div
                      key={book.id}
                      className="book-card"
                      onClick={() => openBook(book.id, book.current_chapter || 1)}
                    >
                      <button
                        className="delete-btn"
                        onClick={(e) => handleDeleteBook(book, e)}
                        title="Xóa sách"
                      >
                        <Trash2 size={14} />
                      </button>
                      <div className="cover-aspect">
                        {coverSrc ? (
                          <img src={coverSrc} alt={book.title} loading="lazy" />
                        ) : (
                          <div className="cover-placeholder">
                            <BookOpen size={36} style={{ opacity: 0.6 }} />
                            <div className="cover-placeholder-title">{book.title}</div>
                          </div>
                        )}
                      </div>
                      <div className="book-details">
                        <div className="card-title" title={book.title}>{book.title}</div>
                        <div className="card-author">{book.author || 'Khuyết danh'}</div>
                        <div className="card-meta">
                          <span>Chương {book.current_chapter}/{book.total_chapters}</span>
                          <span>{percent}%</span>
                        </div>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${percent}%` }}></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </>
      )}

      {/* 2. READER VIEW */}
      {view === 'reader' && (
        <div>
          <header className={`reader-header ${headerVisible ? '' : 'hidden'}`}>
            <button
              className="icon-btn"
              onClick={() => { setView('library'); initApp(); }}
              title="Quay lại Tủ sách"
            >
              <ArrowLeft size={20} />
              <span className="hide-on-mobile" style={{ marginLeft: 6, fontWeight: 600 }}>Tủ sách</span>
            </button>

            <div className="reader-title-truncate">
              {currentChapter ? currentChapter.title : 'Đang tải...'}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <button className="icon-btn" onClick={() => setShowTOC(true)} title="Mục lục">
                <List size={20} />
              </button>
              <button className="icon-btn" onClick={() => setShowSettings(true)} title="Cài đặt hiển thị">
                <Sliders size={20} />
              </button>
              <button className="icon-btn hide-on-mobile" onClick={toggleFullscreen} title="Toàn màn hình">
                {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
              </button>
            </div>
          </header>

          <div className="progress-indicator-bar" style={{ width: `${scrollProgress}%` }} />

          <main className="reading-canvas">
            <div className={`reader-content-box ${settings.font} ${settings.align === 'left' ? 'align-left' : ''}`}>
              {currentChapter ? (
                <>
                  <h2>{currentChapter.title}</h2>
                  <div dangerouslySetInnerHTML={{ __html: currentChapter.content_html }} />
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '6rem 1rem', opacity: 0.6 }}>
                  Đang tải nội dung chương...
                </div>
              )}
            </div>

            <nav className="nav-bottom-bar">
              <button
                className="btn btn-secondary"
                disabled={!currentChapter?.prev_index}
                onClick={prevChapter}
              >
                <ArrowLeft size={18} /> Chương trước
              </button>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                Chương {chapterIndex} / {currentBook?.record?.total_chapters || currentBook?.chapters?.length || 1}
              </div>
              <button
                className="btn btn-primary"
                disabled={!currentChapter?.next_index}
                onClick={nextChapter}
              >
                Chương sau <ArrowRight size={18} />
              </button>
            </nav>
          </main>
        </div>
      )}

      {/* 3. TABLE OF CONTENTS DRAWER */}
      <div
        className={`drawer-overlay ${showTOC ? 'active' : ''}`}
        onClick={() => setShowTOC(false)}
      />
      <aside className={`drawer drawer-left ${showTOC ? 'active' : ''}`}>
        <div className="drawer-head">
          <h3>Mục Lục Chương</h3>
          <button className="icon-btn" onClick={() => setShowTOC(false)}>
            <X size={20} />
          </button>
        </div>
        <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--border-color)' }}>
          <input
            type="text"
            className="search-input"
            style={{ borderRadius: 6, paddingLeft: '1rem' }}
            placeholder="Tìm tên hoặc số chương..."
            value={tocSearch}
            onChange={(e) => setTocSearch(e.target.value)}
          />
        </div>
        <ul className="toc-scroll">
          {currentBook?.chapters
            ?.filter(ch => ch.title.toLowerCase().includes(tocSearch.toLowerCase()))
            .map(ch => (
              <li
                key={ch.index}
                className={`toc-row ${ch.index === chapterIndex ? 'active' : ''}`}
                onClick={() => {
                  setShowTOC(false);
                  if (isServerMode) {
                    loadChapter(currentBook.record.id, ch.index, 0);
                  } else {
                    loadChapterClient(currentBook.record, ch.index, 0);
                  }
                }}
              >
                <span>{ch.title}</span>
                <span style={{ opacity: 0.5, fontSize: '0.8rem' }}>#{ch.index}</span>
              </li>
            ))}
        </ul>
      </aside>

      {/* 4. SETTINGS DRAWER */}
      <div
        className={`drawer-overlay ${showSettings ? 'active' : ''}`}
        onClick={() => setShowSettings(false)}
      />
      <aside className={`drawer drawer-right ${showSettings ? 'active' : ''}`}>
        <div className="drawer-head">
          <h3>Cài Đặt Hiển Thị</h3>
          <button className="icon-btn" onClick={() => setShowSettings(false)}>
            <X size={20} />
          </button>
        </div>
        <div className="settings-body">
          <div className="config-group">
            <div className="config-label">Giao diện đọc</div>
            <div className="theme-grid">
              <button
                className={`theme-choice white ${settings.theme === 'white' ? 'selected' : ''}`}
                onClick={() => setSettings(s => ({ ...s, theme: 'white' }))}
              >Sáng</button>
              <button
                className={`theme-choice sepia ${settings.theme === 'sepia' ? 'selected' : ''}`}
                onClick={() => setSettings(s => ({ ...s, theme: 'sepia' }))}
              >Ấm áp</button>
              <button
                className={`theme-choice slate ${settings.theme === 'slate' ? 'selected' : ''}`}
                onClick={() => setSettings(s => ({ ...s, theme: 'slate' }))}
              >Ban đêm</button>
              <button
                className={`theme-choice oled ${settings.theme === 'oled' ? 'selected' : ''}`}
                onClick={() => setSettings(s => ({ ...s, theme: 'oled' }))}
              >OLED</button>
            </div>
          </div>

          <div className="config-group">
            <div className="config-label">Phông chữ</div>
            <div className="font-grid">
              <button
                className={`font-choice ${settings.font === 'font-literata' ? 'selected' : ''}`}
                style={{ fontFamily: 'Literata, serif' }}
                onClick={() => setSettings(s => ({ ...s, font: 'font-literata' }))}
              >Literata</button>
              <button
                className={`font-choice ${settings.font === 'font-merriweather' ? 'selected' : ''}`}
                style={{ fontFamily: 'Merriweather, serif' }}
                onClick={() => setSettings(s => ({ ...s, font: 'font-merriweather' }))}
              >Merriweather</button>
              <button
                className={`font-choice ${settings.font === 'font-lora' ? 'selected' : ''}`}
                style={{ fontFamily: 'Lora, serif' }}
                onClick={() => setSettings(s => ({ ...s, font: 'font-lora' }))}
              >Lora</button>
              <button
                className={`font-choice ${settings.font === 'font-vietnam' ? 'selected' : ''}`}
                style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}
                onClick={() => setSettings(s => ({ ...s, font: 'font-vietnam' }))}
              >Vietnam Pro</button>
              <button
                className={`font-choice ${settings.font === 'font-inter' ? 'selected' : ''}`}
                style={{ fontFamily: 'Inter, sans-serif' }}
                onClick={() => setSettings(s => ({ ...s, font: 'font-inter' }))}
              >Inter</button>
              <button
                className={`font-choice ${settings.font === 'font-playfair' ? 'selected' : ''}`}
                style={{ fontFamily: 'Playfair Display, serif' }}
                onClick={() => setSettings(s => ({ ...s, font: 'font-playfair' }))}
              >Playfair</button>
            </div>
          </div>

          <div className="config-group">
            <div className="config-label">
              <span>Cỡ chữ</span>
              <span style={{ color: 'var(--accent-color)' }}>{settings.fontSize}px</span>
            </div>
            <input
              type="range"
              min="14"
              max="34"
              value={settings.fontSize}
              onChange={(e) => setSettings(s => ({ ...s, fontSize: parseInt(e.target.value) }))}
            />
          </div>

          <div className="config-group">
            <div className="config-label">
              <span>Giãn dòng</span>
              <span style={{ color: 'var(--accent-color)' }}>{settings.lineHeight}</span>
            </div>
            <input
              type="range"
              min="1.4"
              max="2.4"
              step="0.05"
              value={settings.lineHeight}
              onChange={(e) => setSettings(s => ({ ...s, lineHeight: parseFloat(e.target.value) }))}
            />
          </div>

          <div className="config-group">
            <div className="config-label">
              <span>Độ rộng trang</span>
              <span style={{ color: 'var(--accent-color)' }}>{settings.maxWidth}px</span>
            </div>
            <input
              type="range"
              min="600"
              max="1100"
              step="20"
              value={settings.maxWidth}
              onChange={(e) => setSettings(s => ({ ...s, maxWidth: parseInt(e.target.value) }))}
            />
          </div>

          <div className="config-group">
            <div className="config-label">Căn lề văn bản</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <button
                className={`font-choice ${settings.align === 'justify' ? 'selected' : ''}`}
                onClick={() => setSettings(s => ({ ...s, align: 'justify' }))}
              >Căn đều 2 bên</button>
              <button
                className={`font-choice ${settings.align === 'left' ? 'selected' : ''}`}
                onClick={() => setSettings(s => ({ ...s, align: 'left' }))}
              >Căn trái</button>
            </div>
          </div>
        </div>
      </aside>

      <div className={`toast-msg ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
