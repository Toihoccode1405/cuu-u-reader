import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  BookOpen, Search, Plus, Trash2, ArrowLeft, ArrowRight,
  List, Sliders, Maximize, Minimize, X, History,
  PlayCircle, User, LogOut, UploadCloud, Flag, Highlighter, Keyboard, Copy, Download,
  Edit3, Check, ChevronLeft, ChevronRight, ChevronDown, MoreHorizontal, ShieldAlert
} from 'lucide-react';
import AuthPage from './AuthPage';
import XhIcon, { XhSprite } from './XhIcon';
import { getApiUrl } from './api';
import { prepareChapters } from './chapterPrep';
import RealmIcon from './RealmIcon';
import RealmPath from './RealmPath';
import { fetchCultivation, runBackfill, setCultivationEnabled, submitReading, flushReportQueue, hasQueuedReports, clearReportQueue } from './cultivation';
import { parseEpubClient, saveBookToDB, getBookFromDB, loadChapterFromEpubBlob } from './storage';

export default function App() {
  // Cloud Auth State
  // Phiên đăng nhập nằm trong cookie HttpOnly do máy chủ đặt: JavaScript không đọc được token,
  // nên trạng thái đăng nhập được hỏi lại máy chủ (/api/auth/me) mỗi lần mở trang.
  const [cloudUser, setCloudUser] = useState(null);

  // View routing: 'loading' (đang hỏi máy chủ) -> 'auth' hoặc 'library'
  const [view, setView] = useState('loading');

  // Library & History Data
  const [books, setBooks] = useState([]);
  const [history, setHistory] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadProgress, setUploadProgress] = useState(null);
  const [topProgress, setTopProgress] = useState(null);
  const [toast, setToast] = useState(null);

  // Active Reading State
  const [currentBook, setCurrentBook] = useState(null);
  const [currentChapter, setCurrentChapter] = useState(null);
  const [chapterIndex, setChapterIndex] = useState(1);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [headerVisible, setHeaderVisible] = useState(true);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const upDistRef = useRef(0);
  const headerQuietUntilRef = useRef(0); // sau khi mở chương, cuộn tự động về vị trí đọc dở không được làm ẩn thanh

  // Drawers & Settings
  const [showTOC, setShowTOC] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [tocSearch, setTocSearch] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Bookmarks (Cờ đánh dấu vị trí đọc) + exact paragraph tracking
  const [bookmarks, setBookmarks] = useState([]);
  const [activeParaIndex, setActiveParaIndex] = useState(0);
  const [focusParaIndex, setFocusParaIndex] = useState(-1);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedPara, setSelectedPara] = useState(null);
  const [editModal, setEditModal] = useState(null);

  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('cuu_u_reader_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Legacy theme ids -> ids actually defined in the stylesheet
        const themeMap = { paper: 'white', dark: 'slate' };
        if (themeMap[parsed.theme]) parsed.theme = themeMap[parsed.theme];
        if (parsed.font === 'font-vietnam') parsed.font = 'font-be-vietnam';
        if (parsed.letterSpacing === undefined) parsed.letterSpacing = 0;
        if (parsed.fontSize === undefined) parsed.fontSize = 19;
        if (parsed.lineHeight === undefined) parsed.lineHeight = 1.8;
        if (parsed.allowSelect === undefined) parsed.allowSelect = false;
        if (parsed.indent === undefined) parsed.indent = true;
        return parsed;
      } catch (e) {}
    }
    return {
      theme: 'sepia',
      font: 'font-athelas',
      fontSize: 19,
      lineHeight: 1.8,
      letterSpacing: 0,
      maxWidth: 820,
      justify: true,
      indent: true,
      allowSelect: false
    };
  });

  const prepAbortRef = useRef(null);
  const [prepProgress, setPrepProgress] = useState(null);

  // Tu vi / cảnh giới (máy chủ tính; ở đây chỉ hiển thị và báo "đã đọc đoạn nào")
  const [cultivation, setCultivation] = useState(null);
  const [breakthrough, setBreakthrough] = useState(null);
  const [showRealmPath, setShowRealmPath] = useState(false);
  const cultivationRef = useRef(null);
  cultivationRef.current = cultivation;
  const breakthroughTimerRef = useRef(null);

  const applyReports = useCallback((results) => {
    if (!results || !results.length) return;
    const last = results[results.length - 1];
    setCultivation(prev => (prev ? { ...prev, tu_vi: last.tu_vi, realm: last.realm } : prev));
    const bt = [...results].reverse().find(r => r.breakthrough);
    if (bt && cultivationRef.current && cultivationRef.current.enabled !== false) {
      setBreakthrough(bt.realm);
      clearTimeout(breakthroughTimerRef.current);
      breakthroughTimerRef.current = setTimeout(() => setBreakthrough(null), 5000);
    }
  }, []);
  const lastScrollTopRef = useRef(0);
  const scrollTimeoutRef = useRef(null);
  const pendingRestoreRef = useRef(null);
  const focusParaRef = useRef(-1);
  const focusChapterRef = useRef(-1);
  const holdTimerRef = useRef(null);
  const isLongPressRef = useRef(false);
  const pointerStartPosRef = useRef(null);
  const shortcutsRef = useRef({});
  const settingsTimeoutRef = useRef(null);
  const lastSavedSettingsRef = useRef(null);
  const progressTimerRef = useRef(null);

  const startTopProgress = useCallback(() => {
    clearInterval(progressTimerRef.current);
    setTopProgress(18);
    progressTimerRef.current = setInterval(() => {
      setTopProgress((prev) => {
        if (prev === null) return 18;
        if (prev >= 88) return prev;
        const diff = 88 - prev;
        const step = Math.max(1, Math.round(diff * 0.15));
        return prev + step;
      });
    }, 180);
  }, []);

  const completeTopProgress = useCallback(() => {
    clearInterval(progressTimerRef.current);
    progressTimerRef.current = null;
    setTopProgress(100);
    setTimeout(() => {
      setTopProgress(null);
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      clearInterval(progressTimerRef.current);
    };
  }, []);

  const showToast = useCallback((msg, ms = 3000) => {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  }, []);

  const getCoverUrl = useCallback((bookId) => getApiUrl(`/api/books/${bookId}/cover`), []);

  // Dòng được coi là "đang nhìn thấy" nếu toàn bộ chiều cao của nó nằm trong
  // vùng đọc, trừ header cố định ở trên và chừa mép dưới.
  const isElementFullyVisible = useCallback((el) => {
    const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 56;
    const topLimit = headerH + 8;
    const bottomLimit = window.innerHeight - 8;
    const r = el.getBoundingClientRect();
    return r.top >= topLimit && r.bottom <= bottomLimit;
  }, []);

  // Sync settings with DOM & localStorage & Cloudflare D1
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.documentElement.style.setProperty('--reader-font-size', `${settings.fontSize}px`);
    document.documentElement.style.setProperty('--reader-line-height', settings.lineHeight);
    document.documentElement.style.setProperty('--reader-letter-spacing', `${settings.letterSpacing}px`);
    document.documentElement.style.setProperty('--reader-max-width', `${settings.maxWidth}px`);
    localStorage.setItem('cuu_u_reader_settings', JSON.stringify(settings));

    const serialized = JSON.stringify(settings);
    if (cloudUser && serialized !== lastSavedSettingsRef.current) {
      clearTimeout(settingsTimeoutRef.current);
      settingsTimeoutRef.current = setTimeout(async () => {
        try {
          await fetch(getApiUrl('/api/settings'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ settings })
          });
          lastSavedSettingsRef.current = serialized;
        } catch (e) {}
      }, 600);
    }
  }, [settings, cloudUser]);

  // ---------------------------------------------------------------------------
  // DATA LOADING (AUTO SYNC FROM CLOUDFLARE D1)
  // ---------------------------------------------------------------------------

  const loadUserData = useCallback(async () => {
    startTopProgress();
    try {

      // 1. Fetch Books
      const booksRes = await fetch(getApiUrl('/api/books'));
      if (booksRes.status === 401) {
        handleLogout();
        return;
      }
      if (booksRes.ok) {
        const booksData = await booksRes.json();
        setBooks(booksData);
      }

      // 2. Fetch Multi-Book Reading History
      const histRes = await fetch(getApiUrl('/api/history'));
      if (histRes.ok) {
        const histData = await histRes.json();
        setHistory(histData);
      }

      // 3. Fetch Reader Settings from Cloud
      const settingsRes = await fetch(getApiUrl('/api/settings'));
      if (settingsRes.ok) {
        const { settings: cloudSettings } = await settingsRes.json();
        if (cloudSettings && typeof cloudSettings === 'object' && Object.keys(cloudSettings).length > 0) {
          const themeMap = { paper: 'white', dark: 'slate' };
          if (themeMap[cloudSettings.theme]) cloudSettings.theme = themeMap[cloudSettings.theme];
          if (cloudSettings.font === 'font-vietnam') cloudSettings.font = 'font-be-vietnam';
          lastSavedSettingsRef.current = JSON.stringify(cloudSettings);
          setSettings(prev => ({ ...prev, ...cloudSettings }));
        }
      }
    } catch (e) {
      showToast('Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng.');
    } finally {
      completeTopProgress();
    }
  }, [showToast, startTopProgress, completeTopProgress]);

  // Mở trang: hỏi máy chủ xem cookie phiên còn hiệu lực không
  useEffect(() => {
    // Xóa token cũ còn sót trong localStorage từ phiên bản trước khi chuyển sang cookie HttpOnly
    try {
      localStorage.removeItem('cuu_u_cloud_token');
      localStorage.removeItem('cuu_u_cloud_user');
    } catch (e) { /* trình duyệt chặn localStorage: bỏ qua */ }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(getApiUrl('/api/auth/me'));
        if (cancelled) return;
        if (res.ok) {
          const { user } = await res.json();
          if (user) {
            setCloudUser({ id: user.userId, username: user.username });
            setView('library');
            return;
          }
        }
      } catch (e) {
        // mất mạng: về trang đăng nhập
      }
      if (!cancelled) setView('auth');
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto load on startup if logged in
  useEffect(() => {
    if (cloudUser) {
      loadUserData();
    }
  }, [cloudUser, loadUserData]);

  // Auto re-sync when tab gains focus (e.g., switched from phone to PC)
  useEffect(() => {
    const handleFocus = () => {
      if (cloudUser && view === 'library') {
        loadUserData();
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [cloudUser, view, loadUserData]);

  // Khi đăng nhập: cộng hồi tố (một lần), lấy trạng thái tu vi, gửi bù báo cáo còn kẹt
  useEffect(() => {
    if (!cloudUser) return;
    let off = false;
    (async () => {
      await runBackfill();
      const state = await fetchCultivation();
      if (!off && state) setCultivation(state);
      const flushed = await flushReportQueue();
      if (!off) applyReports(flushed.results);
    })();
    return () => { off = true; };
  }, [cloudUser?.id, applyReports]);

  // Có mạng lại (hoặc định kỳ khi còn báo cáo kẹt): gửi bù
  useEffect(() => {
    if (!cloudUser) return;
    const retry = async () => {
      if (!hasQueuedReports()) return;
      const flushed = await flushReportQueue();
      applyReports(flushed.results);
    };
    window.addEventListener('online', retry);
    const id = setInterval(retry, 20000);
    return () => { window.removeEventListener('online', retry); clearInterval(id); };
  }, [cloudUser?.id, applyReports]);

  // Theo dõi việc đọc: mỗi giây ghi nhận các đoạn đang hiện trên màn hình.
  // Chỉ đoạn MỚI hiện ra trong lần mở chương này mới được báo (ngồi yên trên một màn hình không được cộng lặp),
  // và chỉ báo khi thời gian đã trôi qua đủ để đọc hết số từ đó ở tốc độ tối đa được tính.
  const readingBookId = currentBook?.record?.id;
  const readingChapter = currentChapter?.chapter_index;
  useEffect(() => {
    if (view !== 'reader' || !readingBookId || !readingChapter) return;
    const WORDS_PER_SECOND = 20; // phải khớp MAX_WORDS_PER_SECOND của máy chủ
    const MAX_BANK = 120;
    const reported = new Set(); // đoạn đã báo trong lần mở chương này
    const pending = new Map(); // đoạn đã thấy nhưng chưa báo: chỉ số -> số từ
    let bank = 0; // số giây đã đọc (trang hiển thị và có đoạn trên màn hình) kể từ lần báo trước

    const flush = (force) => {
      if (bank < 1 || pending.size === 0) return;
      const budget = Math.floor(bank * WORDS_PER_SECOND);
      const sorted = [...pending.keys()].sort((x, y) => x - y);
      // Lấy đoạn liền nhau đầu tiên, nhiều tới mức số từ còn nằm trong thời gian đã đọc
      let words = 0;
      const run = [];
      for (const i of sorted) {
        if (run.length && i !== run[run.length - 1] + 1) break;
        const w = pending.get(i);
        if (words + w > budget && run.length) break;
        if (words + w > budget && !run.length && !(force || bank >= MAX_BANK)) return; // chưa đủ thời gian đọc, đợi thêm
        run.push(i);
        words += w;
        if (words >= budget) break;
      }
      if (!run.length) return;
      submitReading({
        book_id: readingBookId,
        chapter_index: readingChapter,
        from_para: run[0],
        to_para: run[run.length - 1],
        seconds: Math.min(bank, MAX_BANK),
        at: Date.now(),
      }).then(applyReports);
      run.forEach((i) => { reported.add(i); pending.delete(i); });
      bank = 0;
    };

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      let seen = false;
      document.querySelectorAll('.reader-body [data-p]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < window.innerHeight) {
          seen = true;
          const i = Number(el.getAttribute('data-p'));
          if (Number.isInteger(i) && !reported.has(i) && !pending.has(i)) {
            pending.set(i, (el.textContent || '').trim().split(/\s+/).filter(Boolean).length);
          }
        }
      });
      if (seen) bank = Math.min(MAX_BANK, bank + 1);
      if (bank >= 10) flush(false);
    };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(true); };
    const onPageHide = () => flush(true);
    const id = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      flush(true);
    };
  }, [view, readingBookId, readingChapter, applyReports]);

  const handleToggleCultivation = async (enabled) => {
    setCultivation(prev => (prev ? { ...prev, enabled } : prev));
    const state = await setCultivationEnabled(enabled);
    if (state) setCultivation(state);
  };

  // ---------------------------------------------------------------------------
  // AUTHENTICATION HANDLERS
  // ---------------------------------------------------------------------------

  const handleLoginSuccess = (user) => {
    setCloudUser(user);
    // Để Service Worker lưu thông tin phiên cho lần mở offline
    fetch(getApiUrl('/api/auth/me')).catch(() => {});
    setView('library');
    showToast(`Chào mừng ${user.username}!`);
    loadUserData();
  };

  // Tách chương ở nền (xem chapterPrep.js). Hủy khi đăng xuất.
  const startChapterPrep = (bookId, toc, getSource) => {
    if (!toc || !toc.length) return;
    if (!prepAbortRef.current) prepAbortRef.current = new AbortController();
    prepareChapters({
      bookId,
      toc,
      getSource,
      signal: prepAbortRef.current.signal,
      onProgress: setPrepProgress,
    });
  };

  const handleLogout = () => {
    if (prepAbortRef.current) {
      prepAbortRef.current.abort();
      prepAbortRef.current = null;
    }
    setPrepProgress(null);
    setCultivation(null);
    setBreakthrough(null);
    clearReportQueue();
    // Xóa dữ liệu đọc đã lưu cho chế độ offline của tài khoản này
    if (typeof caches !== 'undefined') caches.delete('cuu-data-v1').catch(() => {});
    // Báo máy chủ xóa cookie phiên (thiết bị khác vẫn đăng nhập); không chờ kết quả
    fetch(getApiUrl('/api/auth/logout'), { method: 'POST' }).catch(() => {});
    setCloudUser(null);
    setBooks([]);
    setHistory([]);
    setCurrentBook(null);
    setCurrentChapter(null);
    setView('auth');
    showToast('Đã đăng xuất.');
  };

  // Vô hiệu mọi token đã cấp (mọi thiết bị) rồi đăng xuất thiết bị này
  const handleLogoutAll = async () => {
    if (!window.confirm('Đăng xuất khỏi TẤT CẢ thiết bị đang đăng nhập tài khoản này?')) return;
    try {
      await fetch(getApiUrl('/api/auth/logout-all'), {
        method: 'POST',
      });
    } catch (e) {
      // Mất mạng: vẫn đăng xuất cục bộ, nhưng các phiên khác chưa bị thu hồi trên máy chủ
    }
    handleLogout();
  };

  // ---------------------------------------------------------------------------
  // BOOK MANAGEMENT (UPLOAD & DELETE)
  // ---------------------------------------------------------------------------

  const handleUpload = async (file) => {
    if (!file || !file.name.toLowerCase().endsWith('.epub')) {
      showToast('Vui lòng chọn file định dạng .epub');
      return;
    }

    startTopProgress();
    setUploadProgress({
      fileName: file.name,
      percent: 0,
      loaded: 0,
      total: file.size,
      statusText: 'Đang đọc và phân tích cấu trúc EPUB...'
    });

    // Client-side pre-parse: fast, zero-server-CPU, extracts TOC & cover locally
    let clientMetadata = null;
    try {
      const parsed = await parseEpubClient(file);
      if (parsed) {
        clientMetadata = {
          title: parsed.title,
          author: parsed.author,
          coverBase64: parsed.cover_data,
          chapters: parsed.chapters
        };
        // Also cache in local IndexedDB for instant offline reading
        await saveBookToDB(parsed).catch(e => console.warn('Local DB save ignored:', e));
      }
    } catch (parseErr) {
      console.warn('Client EPUB pre-parse skipped:', parseErr);
    }

    setUploadProgress({
      fileName: file.name,
      percent: 5,
      loaded: 0,
      total: file.size,
      statusText: 'Đang chuẩn bị tải lên máy chủ...'
    });

    const formData = new FormData();
    formData.append('file', file);
    if (clientMetadata) {
      formData.append('metadata', JSON.stringify(clientMetadata));
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', getApiUrl('/api/books/upload'));

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        const pct = Math.min(99, Math.round((e.loaded / e.total) * 100));
        setUploadProgress({
          fileName: file.name,
          percent: Math.max(5, pct),
          loaded: e.loaded,
          total: e.total,
          statusText: pct >= 99 ? 'Đang lưu trữ và đồng bộ sách trên máy chủ...' : `Đang tải lên: ${pct}%`
        });
      }
    };

    xhr.onload = async () => {
      completeTopProgress();
      if (xhr.status >= 200 && xhr.status < 300) {
        setUploadProgress({
          fileName: file.name,
          percent: 100,
          loaded: file.size,
          total: file.size,
          statusText: 'Tải lên hoàn tất!'
        });
        try {
          const newBook = JSON.parse(xhr.responseText);
          showToast(`Đã thêm thành công: ${newBook.title}!`);
          if (newBook.id && clientMetadata && clientMetadata.chapters) {
            startChapterPrep(newBook.id, clientMetadata.chapters, async () => file);
          }
        } catch {
          showToast('Đã thêm sách thành công!');
        }
        setTimeout(() => setUploadProgress(null), 600);
        await loadUserData();
      } else {
        setUploadProgress(null);
        let errorMsg = `Mã lỗi ${xhr.status}`;
        try {
          const resJson = JSON.parse(xhr.responseText);
          if (resJson && resJson.error) {
            errorMsg = resJson.error;
          }
        } catch {
          const titleMatch = (xhr.responseText || '').match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) {
            errorMsg = `Máy chủ: ${titleMatch[1].trim()}`;
          } else if (xhr.responseText && xhr.responseText.length < 200) {
            errorMsg = xhr.responseText;
          }
        }
        alert(`Lỗi tải sách: ${errorMsg}`);
      }
    };

    xhr.onerror = () => {
      completeTopProgress();
      setUploadProgress(null);
      alert('Lỗi kết nối khi tải sách lên máy chủ. Vui lòng kiểm tra lại đường truyền mạng.');
    };

    xhr.send(formData);
  };

  const handleDeleteBook = async (book, e) => {
    e.stopPropagation();
    if (window.confirm(`Bạn có chắc muốn xóa "${book.title}" khỏi thư các?`)) {
      startTopProgress();
      try {
        const res = await fetch(getApiUrl(`/api/books/${book.id}`), {
          method: 'DELETE',
                  });
        if (res.ok) {
          showToast(`Đã xóa: ${book.title}`);
          await loadUserData();
        }
      } catch (e) {
        showToast('Lỗi khi xóa sách');
      } finally {
        completeTopProgress();
      }
    }
  };

  const handleDownloadBook = async (book, e) => {
    if (e) e.stopPropagation();
    const bookId = book.id || book.record?.id;
    const title = book.title || book.record?.title || 'cuu-u-sach';
    startTopProgress();
    try {
      showToast(`Đang chuẩn bị tải: ${title}...`);
      const url = getApiUrl(`/api/books/${bookId}/file`);
      const res = await fetch(url, {
      });
      if (!res.ok) throw new Error('Không thể tải file sách từ máy chủ');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${title}.epub`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      showToast(`Đã tải xong: ${title}`);
    } catch (err) {
      showToast(err.message || 'Lỗi khi tải file sách');
    } finally {
      completeTopProgress();
    }
  };

  // ---------------------------------------------------------------------------
  // READER ENGINE & AUTO PROGRESS SYNC
  // ---------------------------------------------------------------------------

  const openBook = async (bookId, targetChapter = 1, restoreScroll = 0, restorePara = null) => {
    showToast('Đang mở sách...');
    startTopProgress();

    try {
      let bookData = null;
      try {
        const res = await fetch(getApiUrl(`/api/books/${bookId}`), {
                  });
        if (res.ok) {
          bookData = await res.json();
        }
      } catch (netErr) {
        console.warn('Network book detail failed, checking local:', netErr);
      }

      if (!bookData) {
        const localBook = await getBookFromDB(bookId).catch(() => null);
        if (localBook) {
          bookData = {
            record: {
              id: localBook.id,
              title: localBook.title,
              author: localBook.author,
              total_chapters: localBook.total_chapters || (localBook.chapters ? localBook.chapters.length : 0),
              current_chapter: localBook.current_chapter || 1,
              scroll_percent: localBook.scroll_percent || 0,
              para_index: localBook.para_index || 0,
              focus_para: -1,
              focus_chapter: -1,
              has_cover: !!localBook.cover_data,
              added_at: localBook.added_at
            },
            chapters: localBook.chapters || []
          };
        }
      }

      if (!bookData) throw new Error('Không thể tải thông tin sách.');

      setCurrentBook(bookData);
      setChapterIndex(targetChapter);
      setView('reader');
      window.scrollTo({ top: 0, behavior: 'instant' });

      await loadBookmarks(bookId);

      // Sách cũ chưa được tách chương: tách bù ở nền (chỉ tải file EPUB khi còn chương thiếu)
      if (bookData.chapters && bookData.chapters.length && bookData.chapters[0].href) {
        startChapterPrep(bookId, bookData.chapters, async () => {
          const r = await fetch(getApiUrl(`/api/books/${bookId}/file`));
          return r.ok ? r.blob() : null;
        });
      }

      const para = restorePara !== null ? restorePara : (bookData.record.para_index || 0);
      const pct = restoreScroll || bookData.record.scroll_percent || 0;
      const focus = bookData.record.focus_para ?? -1;
      const focusChapter = bookData.record.focus_chapter ?? -1;
      focusParaRef.current = focus;
      focusChapterRef.current = focusChapter;
      await loadChapter(bookId, targetChapter, pct, bookData.record.title, para, focus, focusChapter);
    } catch (e) {
      showToast(e.message);
    } finally {
      completeTopProgress();
    }
  };

  const loadChapter = async (bookId, idx, restoreScroll = 0, explicitTitle = null, restorePara = null, restoreFocus = null, restoreFocusChapter = null) => {
    startTopProgress();
    try {
      let data = null;
      try {
        const res = await fetch(getApiUrl(`/api/books/${bookId}/chapters/${idx}`), {
                  });
        if (res.ok) {
          data = await res.json();
        }
      } catch (netErr) {
        console.warn('Network load chapter failed, checking local cache:', netErr);
      }

      if (!data) {
        // Fallback to local IndexedDB if available on this device
        const localBook = await getBookFromDB(bookId).catch(() => null);
        if (localBook && localBook.epub_blob) {
          data = await loadChapterFromEpubBlob(localBook, idx);
        }
      }

      if (!data) throw new Error('Không thể tải nội dung chương.');

      // Queue exact-position restore; consumed by the render effect below
      pendingRestoreRef.current = {
        para: restorePara,
        pct: restoreScroll || 0,
        focus: restoreFocus,
        focusChapter: restoreFocusChapter
      };

      window.scrollTo({ top: 0, behavior: 'instant' });
      setCurrentChapter(data);
      setChapterIndex(idx);

      const bTitle = explicitTitle || currentBook?.record?.title || currentBook?.title;
      saveProgressToCloud(bookId, data.title, idx, restoreScroll || 0, bTitle, restorePara || 0);
    } catch (e) {
      showToast(e.message);
    } finally {
      completeTopProgress();
    }
  };

  // Assigns a stable data-p index to every readable block of the chapter.
  // Same HTML -> same indices on every device, so a saved position maps 1:1.
  const indexParagraphs = useCallback(() => {
    const container = document.querySelector('.reader-body');
    if (!container) return [];

    const blocks = Array.from(container.querySelectorAll('p, div')).filter(el => {
      const text = (el.textContent || '').trim();
      if (text.length < 2) return false;
      const hasNestedBlock = Array.from(el.children).some(
        ch => /^(P|DIV)$/.test(ch.tagName) && (ch.textContent || '').trim().length > 1
      );
      return !hasNestedBlock;
    });

    blocks.forEach((el, i) => el.setAttribute('data-p', String(i)));
    return blocks;
  }, []);

  // The block that sits at the top of the viewport right now.
  const getActiveParaIndex = useCallback(() => {
    const container = document.querySelector('.reader-body');
    if (!container) return 0;

    const blocks = Array.from(container.querySelectorAll('[data-p]'));
    if (blocks.length === 0) return 0;

    const headerOffset = 96;
    for (const el of blocks) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom > headerOffset && rect.top < window.innerHeight - 40) {
        return parseInt(el.getAttribute('data-p'), 10) || 0;
      }
    }
    return blocks.length - 1;
  }, []);

  const flashParagraph = (paraIndex, { scroll = true, keepMs = 5000 } = {}) => {
    const el = document.querySelector(`.reader-body [data-p="${paraIndex}"]`);
    if (!el) return;

    document.querySelectorAll('.reading-highlight-line').forEach(n => n.classList.remove('reading-highlight-line'));

    if (scroll) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    el.classList.add('reading-highlight-line');
    setTimeout(() => el.classList.remove('reading-highlight-line'), keepMs);
  };

  // Applies persistent flag markers for every bookmark of the open chapter.
  const applyBookmarkMarkers = useCallback((list, chapIdx) => {
    document.querySelectorAll('.bookmarked-para').forEach(el => el.classList.remove('bookmarked-para'));
    (list || [])
      .filter(bm => bm.chapter_index === chapIdx)
      .forEach(bm => {
        const el = document.querySelector(`.reader-body [data-p="${bm.para_index}"]`);
        if (el) el.classList.add('bookmarked-para');
      });
  }, []);

  // Dòng đang được ghim (nhấn 2 lần) - giữ lại qua các lần mở sách.
  // Ghim luôn gắn với ĐÚNG chương đã ghim: sang chương khác thì không sáng nữa,
  // nhưng quay lại chương cũ vẫn còn nguyên.
  const paintFocus = useCallback((paraIdx) => {
    document.querySelectorAll('.focused-line').forEach(el => el.classList.remove('focused-line'));
    if (paraIdx === null || paraIdx === undefined || paraIdx < 0) return;
    if (focusChapterRef.current !== chapterIndex) return;
    const el = document.querySelector(`.reader-body [data-p="${paraIdx}"]`);
    if (el) el.classList.add('focused-line');
  }, [chapterIndex]);


  const isParaBookmarked = useCallback((paraIdx) => {
    return bookmarks.some(b => b.chapter_index === chapterIndex && b.para_index === paraIdx);
  }, [bookmarks, chapterIndex]);

  const openSelectionMenu = (paraIdx) => {
    const el = document.querySelector(`.reader-body [data-p="${paraIdx}"]`);
    setSelectedPara({
      para: paraIdx,
      excerpt: el ? (el.textContent || '').trim().slice(0, 110) : '',
      fullText: el ? (el.textContent || '').trim() : '',
      bookmarked: isParaBookmarked(paraIdx)
    });
  };

  const flagSelectedPara = async () => {
    if (!selectedPara) return;
    setSelectedPara(null);
    await flagParagraph(selectedPara.para);
  };

  const copySelectedPara = async () => {
    if (!selectedPara) return;
    const el = document.querySelector(`.reader-body [data-p="${selectedPara.para}"]`);
    const text = el ? (el.textContent || '').trim() : '';
    try {
      await navigator.clipboard.writeText(text);
      showToast('Đã sao chép đoạn văn');
    } catch (e) {
      showToast('Không sao chép được trên thiết bị này');
    }
    setSelectedPara(null);
  };

  const handleStartEditPara = () => {
    if (!selectedPara) return;
    setEditModal({
      type: 'para',
      paraIndex: selectedPara.para,
      title: `Sửa Đoạn ${selectedPara.para + 1}`,
      text: selectedPara.fullText || ''
    });
    setSelectedPara(null);
  };

  const openChapterEditor = () => {
    if (!currentChapter) return;
    const container = document.querySelector('.reader-body');
    let plainText = '';
    if (container) {
      const blocks = Array.from(container.querySelectorAll('[data-p], p, div'));
      if (blocks.length > 0) {
        const lines = blocks
          .map(b => (b.textContent || '').trim())
          .filter(t => t.length > 0);
        plainText = Array.from(new Set(lines)).join('\n\n');
      } else {
        plainText = (container.textContent || '').trim();
      }
    } else {
      plainText = (currentChapter.content_html || '').replace(/<[^>]+>/g, '\n').replace(/\n\s*\n/g, '\n\n').trim();
    }

    setEditModal({
      type: 'chapter',
      title: currentChapter.title || `Chương ${chapterIndex}`,
      text: plainText
    });
  };

  const handleSaveEditModal = async () => {
    if (!editModal || !currentBook || !currentChapter) return;
    const bookId = currentBook.record ? currentBook.record.id : currentBook.id;

    if (editModal.type === 'para') {
      const el = document.querySelector(`.reader-body [data-p="${editModal.paraIndex}"]`);
      if (el) {
        el.textContent = editModal.text;
      }
      const container = document.querySelector('.reader-body');
      const updatedHtml = container ? container.innerHTML : currentChapter.content_html;

      setCurrentChapter(prev => ({
        ...prev,
        content_html: updatedHtml
      }));

      startTopProgress();
      try {
        const res = await fetch(getApiUrl(`/api/books/${bookId}/chapters/${chapterIndex}`), {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: currentChapter.title,
            content_html: updatedHtml
          })
        });
        if (res.ok) {
          showToast('Đã lưu chỉnh sửa đoạn văn!');
        } else {
          showToast('Lỗi lưu đoạn văn lên máy chủ');
        }
      } catch (err) {
        showToast('Lỗi mạng khi lưu đoạn văn');
      } finally {
        completeTopProgress();
      }
      setEditModal(null);
    } else if (editModal.type === 'chapter') {
      const newTitle = editModal.title.trim() || currentChapter.title;
      const paragraphs = editModal.text
        .split(/\n\s*\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0);

      const updatedHtml = paragraphs.map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>`).join('\n');

      setCurrentChapter(prev => ({
        ...prev,
        title: newTitle,
        content_html: updatedHtml
      }));

      startTopProgress();
      try {
        const res = await fetch(getApiUrl(`/api/books/${bookId}/chapters/${chapterIndex}`), {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: newTitle,
            content_html: updatedHtml
          })
        });
        if (res.ok) {
          showToast('Đã lưu toàn bộ chương thành công!');
        } else {
          showToast('Lỗi lưu chương lên máy chủ');
        }
      } catch (err) {
        showToast('Lỗi mạng khi lưu chương');
      } finally {
        completeTopProgress();
      }
      setEditModal(null);
    }
  };

  const loadBookmarks = async (bookId) => {
    try {
      const res = await fetch(getApiUrl(`/api/books/${bookId}/bookmarks`), {
              });
      if (res.ok) {
        const list = await res.json();
        setBookmarks(list);
        return list;
      }
    } catch (e) {}
    return [];
  };


  // Cắm/bỏ cờ ở một dòng bất kỳ (dùng cho cả nút trên thanh công cụ và nhấn 2 lần)
  const flagParagraph = async (paraIndex) => {
    const bookId = currentBook?.record?.id || currentBook?.id;
    if (!bookId) return;

    const el = document.querySelector(`.reader-body [data-p="${paraIndex}"]`);
    const excerpt = el ? (el.textContent || '').trim().slice(0, 160) : '';

    try {
      const res = await fetch(getApiUrl(`/api/books/${bookId}/bookmarks`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chapter_index: chapterIndex,
          para_index: paraIndex,
          scroll_percent: computeScrollPercent(),
          excerpt
        })
      });

      const data = await res.json();
      const list = await loadBookmarks(bookId);
      applyBookmarkMarkers(list, chapterIndex);

      if (data.removed) {
        showToast('Đã bỏ cờ tại dòng này');
      } else {
        showToast('Đã cắm cờ tại dòng này ⚑');
        flashParagraph(paraIndex, { scroll: false, keepMs: 2200 });
      }
    } catch (e) {
      showToast('Không thể lưu cờ đánh dấu.');
    }
  };

  const toggleBookmark = () => flagParagraph(getActiveParaIndex());

  const toggleFocusLine = (paraIdx, forceHighlight = false) => {
    const target = Number.isFinite(paraIdx) ? paraIdx : getActiveParaIndex();
    const isSamePin = focusChapterRef.current === chapterIndex && focusParaRef.current === target;
    const next = (!forceHighlight && isSamePin) ? -1 : target;
    const nextChapter = next >= 0 ? chapterIndex : -1;

    focusParaRef.current = next;
    focusChapterRef.current = nextChapter;
    setFocusParaIndex(next);
    paintFocus(next);

    if (next >= 0) {
      const el = document.querySelector(`.reader-body [data-p="${target}"]`);
      // Chỉ cuộn khi dòng vừa ghim THỰC SỰ bị khuất khỏi tầm nhìn. Trước đây
      // luôn dùng block:'center' nên mỗi lần ghim là trang bị kéo ra giữa màn
      // hình - rất khó chịu khi dòng đó đang nằm ngay trước mắt.
      if (el && !isElementFullyVisible(el)) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    const bookId = currentBook?.record?.id || currentBook?.id;
    if (bookId) {
      saveProgressToCloud(
        bookId,
        currentChapter?.title || `Chương ${chapterIndex}`,
        chapterIndex,
        computeScrollPercent(),
        currentBook?.record?.title || currentBook?.title,
        getActiveParaIndex(),
        next,
        nextChapter
      );
    }
  };

  const removeBookmark = async (bm) => {
    const bookId = currentBook?.record?.id || currentBook?.id;
    if (!bookId) return;

    try {
      await fetch(getApiUrl(`/api/books/${bookId}/bookmarks`), {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: bm.id })
      });
      const list = await loadBookmarks(bookId);
      applyBookmarkMarkers(list, chapterIndex);
      showToast('Đã bỏ cờ');
    } catch (e) {}
  };

  const jumpToBookmark = async (bm) => {
    const bookId = currentBook?.record?.id || currentBook?.id;
    if (!bookId) return;

    setShowBookmarks(false);

    if (bm.chapter_index !== chapterIndex) {
      const title = currentBook?.record?.title || currentBook?.title;
      await loadChapter(bookId, bm.chapter_index, bm.scroll_percent || 0, title, bm.para_index);
    } else {
      flashParagraph(bm.para_index);
    }
  };

  const computeScrollPercent = () => {
    const sh = document.documentElement.scrollHeight - window.innerHeight;
    const st = window.scrollY || document.documentElement.scrollTop;
    return sh > 0 ? Math.min(100, Math.max(0, (st / sh) * 100)) : 0;
  };

  const saveProgressToCloud = async (bookId, chTitle, idx, scrollPct, explicitBookTitle = null, paraIndex = 0, focusPara = null, focusChapter = null) => {
    if (!cloudUser || !bookId) return;
    try {
      const bTitle = explicitBookTitle || currentBook?.record?.title || currentBook?.title || 'Sách';
      const focusIdx = focusPara === null ? focusParaRef.current : focusPara;
      const focusChap = focusChapter === null ? focusChapterRef.current : focusChapter;
      await fetch(getApiUrl(`/api/books/${bookId}/progress`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chapter_index: idx,
          chapter_title: chTitle,
          scroll_percent: scrollPct,
          para_index: paraIndex,
          focus_para: focusIdx,
          focus_chapter: focusChap,
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
          para_index: paraIndex,
          author: currentBook?.record?.author || '',
          has_cover: currentBook?.record?.has_cover || false,
          updated_at: Date.now()
        }, ...remaining];
      });
    } catch (e) {}
  };

  // Runs after every chapter render: index paragraphs, restore exact spot, repaint flags.
  useEffect(() => {
    if (view !== 'reader' || !currentChapter) return;

    indexParagraphs();

    const pending = pendingRestoreRef.current;
    pendingRestoreRef.current = null;

    applyBookmarkMarkers(bookmarks, chapterIndex);

    // Dòng ghim: ghim gắn với một chương cụ thể.
    //  - Mở sách: lấy ghim từ server.
    //  - Chuyển chương bằng phím/vuốt: GIỮ NGUYÊN ghim cũ (không dời sang chương mới).
    //  - Nhấn "Đọc tiếp"/chọn chương: ghim đi kèm vị trí đang đọc.
    if (pending && pending.focusChapter !== undefined && pending.focusChapter !== null) {
      focusChapterRef.current = pending.focusChapter;
    }
    if (pending && pending.focus !== undefined && pending.focus !== null) {
      focusParaRef.current = pending.focus;
    }

    headerQuietUntilRef.current = Date.now() + 2500;
    setHeaderVisible(true);
    const pinnedHere = focusChapterRef.current === chapterIndex && focusParaRef.current >= 0;
    setFocusParaIndex(pinnedHere ? focusParaRef.current : -1);
    paintFocus(pinnedHere ? focusParaRef.current : -1);

    if (pending && pending.para !== null && pending.para !== undefined) {
      let attempts = 0;
      const fallbackToPercent = () => {
        if (pending.pct > 0) {
          const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
          window.scrollTo({ top: maxScroll * (pending.pct / 100), behavior: 'smooth' });
        }
      };
      // Ưu tiên ghim của đúng chương này; nếu không thì dùng vị trí đang đọc
      const target = pinnedHere
        ? focusParaRef.current
        : pending.para;
      const tryRestore = () => {
        const el = document.querySelector(`.reader-body [data-p="${target}"]`);
        if (el) {
          flashParagraph(target, { scroll: true, keepMs: 6000 });
          setActiveParaIndex(target);
        } else if (attempts < 6) {
          // Images/fonts can still be settling; retry briefly
          attempts += 1;
          setTimeout(tryRestore, 120);
        } else {
          // Stored index is stale (chapter edited/shorter): fall back to scroll percent
          fallbackToPercent();
        }
      };
      setTimeout(tryRestore, 160);
    } else if (pending && pending.pct > 0) {
      setTimeout(() => {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: maxScroll * (pending.pct / 100), behavior: 'smooth' });
      }, 160);
    }
  }, [currentChapter, chapterIndex, view, bookmarks, indexParagraphs, applyBookmarkMarkers, paintFocus]);

  // Menu "⋯" của thanh công cụ: đóng khi bấm ra ngoài, nhấn Esc hoặc khi thanh bị ẩn
  useEffect(() => {
    if (!showMoreMenu) return;
    if (!headerVisible) { setShowMoreMenu(false); return; }
    const onDown = (e) => { if (!e.target.closest('.tb-more-wrap')) setShowMoreMenu(false); };
    const onKey = (e) => { if (e.key === 'Escape') setShowMoreMenu(false); };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [showMoreMenu, headerVisible]);

  // Debounced scroll listener for reading position sync
  useEffect(() => {
    if (view !== 'reader' || !currentBook || !currentChapter) return;

    const handleScroll = () => {
      const st = window.scrollY || document.documentElement.scrollTop;
      const sh = document.documentElement.scrollHeight - window.innerHeight;
      const pct = sh > 0 ? Math.min(100, Math.max(0, (st / sh) * 100)) : 0;
      setScrollProgress(pct);

      // Hide / show header on scroll
      const delta = st - lastScrollTopRef.current;
      if (Date.now() < headerQuietUntilRef.current) { lastScrollTopRef.current = st; upDistRef.current = 0; }
      else if (window.matchMedia('(max-width: 640px)').matches) {
        // Điện thoại: cuộn xuống thì ẩn; chỉ hiện lại khi cuộn ngược đủ dài (150px) hoặc ở đầu chương,
        // để một cú vuốt ngược ngắn không làm thanh công cụ che mất chữ
        if (delta > 8) {
          upDistRef.current = 0;
          if (st > 60) setHeaderVisible(false);
          lastScrollTopRef.current = st;
        } else if (delta < -8) {
          upDistRef.current += -delta;
          lastScrollTopRef.current = st;
          if (st < 60 || upDistRef.current >= 150) setHeaderVisible(true);
        }
      } else if (Math.abs(delta) > 25) {
        setHeaderVisible(st < lastScrollTopRef.current || st < 60);
        lastScrollTopRef.current = st;
      }

      // Debounce saving progress to cloud
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        const paraIdx = getActiveParaIndex();
        setActiveParaIndex(paraIdx);
        saveProgressToCloud(
          currentBook.record ? currentBook.record.id : currentBook.id,
          currentChapter.title,
          chapterIndex,
          pct,
          currentBook.record ? currentBook.record.title : currentBook.title,
          paraIdx
        );
      }, 800);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeoutRef.current);
    };
  }, [view, currentBook, currentChapter, chapterIndex, getActiveParaIndex]);

  // Nhấn giữ (long press) trên 1 dòng/đoạn: mở menu tiện ích.
  // Nhấn (1 lần hay nhiều lần): luôn bôi sáng dòng đó.
  const handlePointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    const target = e.target.closest('.reader-body [data-p]');
    if (!target) return;
    const paraIdx = parseInt(target.getAttribute('data-p'), 10);
    if (!Number.isFinite(paraIdx)) return;

    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
    isLongPressRef.current = false;

    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      if (navigator.vibrate) {
        try { navigator.vibrate(40); } catch (_) {}
      }
      openSelectionMenu(paraIdx);
    }, 450);
  };

  const handlePointerMove = (e) => {
    if (!pointerStartPosRef.current) return;
    const dx = Math.abs(e.clientX - pointerStartPosRef.current.x);
    const dy = Math.abs(e.clientY - pointerStartPosRef.current.y);
    if (dx > 10 || dy > 10) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const handlePointerUp = () => {
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    pointerStartPosRef.current = null;
  };

  const handlePointerCancel = () => {
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    pointerStartPosRef.current = null;
  };

  const handleContextMenu = (e) => {
    const target = e.target.closest('.reader-body [data-p]');
    if (!target) return;
    const paraIdx = parseInt(target.getAttribute('data-p'), 10);
    if (!Number.isFinite(paraIdx)) return;

    e.preventDefault();
    clearTimeout(holdTimerRef.current);
    isLongPressRef.current = true;
    openSelectionMenu(paraIdx);
  };

  const handleReaderTap = (e) => {
    if (isLongPressRef.current) {
      isLongPressRef.current = false;
      return;
    }
    const target = e.target.closest('.reader-body [data-p]');
    if (!target) return;
    const paraIdx = parseInt(target.getAttribute('data-p'), 10);
    if (!Number.isFinite(paraIdx)) return;

    // Ấn 1 lần hay nhiều lần thì vẫn là bôi sáng
    toggleFocusLine(paraIdx, true);
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
  // KEYBOARD SHORTCUTS (chỉ hoạt động khi đang đọc)
  // ---------------------------------------------------------------------------
  shortcutsRef.current = {
    nextChapter: () => {
      const bId = currentBook?.record?.id || currentBook?.id;
      if (bId && currentChapter?.next_index) loadChapter(bId, currentChapter.next_index);
    },
    prevChapter: () => {
      const bId = currentBook?.record?.id || currentBook?.id;
      if (bId && currentChapter?.prev_index) loadChapter(bId, currentChapter.prev_index);
    },
    flag: toggleBookmark,
    focus: () => toggleFocusLine(),
    toc: () => setShowTOC(v => !v),
    settings: () => setShowSettings(v => !v),
    bookmarks: () => setShowBookmarks(v => !v),
    editChapter: openChapterEditor,
    shortcuts: () => setShowShortcuts(v => !v),
    back: () => {
      setView('library');
      loadUserData();
    },
    fullscreen: toggleFullscreen,
    increaseFont: () => setSettings(s => ({ ...s, fontSize: Math.min(34, s.fontSize + 1) })),
    decreaseFont: () => setSettings(s => ({ ...s, fontSize: Math.max(14, s.fontSize - 1) })),
    toggleJustify: () => setSettings(s => ({ ...s, justify: !s.justify })),
    closePanels: () => {
      setShowTOC(false);
      setShowSettings(false);
      setShowBookmarks(false);
      setShowShortcuts(false);
      setSelectedPara(null);
      setEditModal(null);
    }
  };

  useEffect(() => {
    if (view !== 'reader') return;

    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      if (e.altKey || e.metaKey) return;

      const s = shortcutsRef.current;
      const k = e.key;

      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') {
        if (k === ' ') { e.preventDefault(); }
        s.nextChapter();
      } else if (k === 'ArrowLeft' || k === 'PageUp') {
        s.prevChapter();
      } else if (k === 'f' || k === 'F') {
        s.flag();
      } else if (k === 'h' || k === 'H') {
        s.focus();
      } else if (k === 'c' || k === 'C') {
        s.toc();
      } else if (k === 's' || k === 'S') {
        s.settings();
      } else if (k === 'e' || k === 'E') {
        s.editChapter();
      } else if (k === 'm' || k === 'M') {
        s.bookmarks();
      } else if (k === '?' || k === '/') {
        s.shortcuts();
      } else if (k === '+' || k === '=') {
        s.increaseFont();
      } else if (k === '-' || k === '_') {
        s.decreaseFont();
      } else if (k === 'j' || k === 'J') {
        s.toggleJustify();
      } else if (k === 'F11') {
        return;
      } else if (k === 'Escape') {
        s.closePanels();
      } else if (k === 'Backspace' || k === 'BrowserBack') {
        s.back();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

  // ---------------------------------------------------------------------------
  // VIEW 1: AUTH INDEX PAGE (IF NOT LOGGED IN)
  // ---------------------------------------------------------------------------

  // Đang hỏi máy chủ về phiên: chưa hiện gì để tránh nháy trang đăng nhập
  if (view === 'loading') return null;

  if (view === 'auth' || !cloudUser) {
    return <AuthPage onLoginSuccess={handleLoginSuccess} />;
  }

  // ---------------------------------------------------------------------------
  // VIEW 2: LIBRARY VIEW (INDEX FOR LOGGED-IN USERS)
  // ---------------------------------------------------------------------------

  const filteredBooks = books.filter(b =>
    b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (b.author && b.author.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const isCurrentParaBookmarked = bookmarks.some(
    b => b.chapter_index === chapterIndex && b.para_index === activeParaIndex
  );

  return (
    <div>
      <XhSprite />
      {view === 'library' && (
        <>
          <header className="header">
            <div className="header-inner">
              <div className="brand" onClick={() => loadUserData()}>
                <span className="brand-seal">
                  <XhIcon name="seal" />
                </span>
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
                {cultivation && cultivation.enabled && (
                  <button
                    type="button"
                    className={`cultivation-chip buoc-${cultivation.realm.buoc}`}
                    data-testid="cultivation-chip"
                    onClick={() => setShowRealmPath(true)}
                    title={`${cultivation.realm.buoc_name}${cultivation.realm.alias ? ` · ${cultivation.realm.alias}` : ''} · ${cultivation.tu_vi.toLocaleString('vi-VN')} tu vi`}
                  >
                    <span className="cultivation-realm">
                      <RealmIcon name={cultivation.realm.name} size={16} />
                      {cultivation.realm.name} · tầng {cultivation.realm.tang}
                    </span>
                    <span className="cultivation-bar"><span style={{ width: `${Math.round(cultivation.realm.progress * 100)}%` }} /></span>
                  </button>
                )}
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
                    <button
                      className="btn-logout-icon"
                      onClick={handleLogoutAll}
                      title="Đăng xuất mọi thiết bị"
                    >
                      <ShieldAlert size={14} />
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
                    onChange={(e) => {
                      if (e.target.files?.[0]) handleUpload(e.target.files[0]);
                      e.target.value = '';
                    }}
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
                  <XhIcon name="talisman" />
                  <span>Tiến Độ & Lịch Sử Đọc Gần Đây ({history.length})</span>
                </div>
                <div className="history-grid">
                  {history.map((item) => (
                    <div key={item.book_id} className="history-card">
                      {item.has_cover ? (
                        <img
                          src={getCoverUrl(item.book_id)}
                          alt={item.book_title}
                          className="history-cover"
                          referrerPolicy="no-referrer"
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <div className="history-cover-placeholder">
                          <XhIcon name="scroll" style={{ fontSize: '1.9rem' }} />
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
                              <XhIcon name="knot" /> {item.author || 'Tác giả'} • {Math.round(item.scroll_percent || 0)}%
                            </span>
                            <button
                              className="history-resume-btn"
                              onClick={() => openBook(item.book_id, item.chapter_index, item.scroll_percent, item.para_index || 0)}
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
            <div className="xh-divider" aria-hidden="true">
              <span className="xh-line" />
              <XhIcon name="lotus" />
              <span className="xh-line" />
            </div>
            <section>
              <div className="section-header-title">
                <XhIcon name="scroll" />
                <span>Tất Cả Sách Trong Thư Các ({filteredBooks.length})</span>
              </div>

              {filteredBooks.length === 0 ? (
                <div className="empty-state">
                  <XhIcon name="pagoda" />
                  <h3>Thư các của bạn hiện đang trống</h3>
                  <p>Hãy thêm file tiểu thuyết <code>.epub</code> để bắt đầu đọc và đồng bộ trên mọi thiết bị.</p>
                  <label className="btn btn-primary" style={{ marginTop: '1.25rem', cursor: 'pointer' }}>
                    <Plus size={18} />
                    <span>Thêm Sách Vào Thư Các</span>
                    <input
                      type="file"
                      accept=".epub"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        if (e.target.files?.[0]) handleUpload(e.target.files[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              ) : (
                <div className="book-grid">
                  {filteredBooks.map((book) => (
                    <div
                      key={book.id}
                      className="book-card"
                      onClick={() => openBook(book.id, book.current_chapter || 1, book.scroll_percent || 0, book.para_index || 0)}
                    >
                      <div className="book-card-actions">
                        <button
                          className="book-download-btn"
                          title="Tải file EPUB về máy"
                          onClick={(e) => handleDownloadBook(book, e)}
                        >
                          <Download size={15} />
                        </button>
                        <button
                          className="book-delete-btn"
                          title="Xóa sách"
                          onClick={(e) => handleDeleteBook(book, e)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>

                      <div className="book-cover-container">
                        {book.has_cover ? (
                          <img
                            src={getCoverUrl(book.id)}
                            alt={book.title}
                            className="book-cover-img"
                            referrerPolicy="no-referrer"
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                        ) : (
                          <div className="book-cover-placeholder">
                            <XhIcon name="pagoda" style={{ fontSize: '3.2rem' }} />
                          </div>
                        )}
                      </div>

                      <div className="book-info">
                        <h4 className="book-title" title={book.title}>{book.title}</h4>
                        <div className="book-author">{book.author || 'Khuyết danh'}</div>
                        <div className="book-badge">
                          <XhIcon name="banner" /> {book.total_chapters} chương
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
                  loadUserData();
                }}
                title="Quay lại Thư viện"
              >
                <ArrowLeft size={20} />
              </button>

              <div className="reader-title-truncate">
                <span className="brand-seal" style={{ width: 24, height: 24, marginRight: 8 }}>
                  <XhIcon name="sword" />
                </span>
                <strong className="header-book-title">{currentBook.record ? currentBook.record.title : currentBook.title}</strong>
                <span className="header-sep hide-on-mobile" style={{ margin: '0 8px', opacity: 0.5 }}>•</span>
                <span className="header-chapter-title" style={{ fontSize: '0.82rem', opacity: 0.85 }}>{currentChapter.title}</span>
              </div>

              {(() => {
                // inline: bậc màn hình nhỏ nhất mà nút nằm trên thanh (phone < tablet < desktop)
                // menu: nút nằm trong menu "⋯" ở những màn hình nào (upto-tablet: điện thoại + máy tính bảng)
                const actions = [
                  { key: 'prev', title: 'Chương trước (←)', icon: <ChevronLeft size={19} />, onClick: () => shortcutsRef.current.prevChapter(), inline: 'tablet', disabled: !currentChapter.prev_index },
                  { key: 'next', title: 'Chương tiếp theo (→)', icon: <ChevronRight size={19} />, onClick: () => shortcutsRef.current.nextChapter(), inline: 'tablet', disabled: !currentChapter.next_index },
                  { key: 'focus', title: 'Ghim sáng dòng đang đọc (H)', icon: <XhIcon name="moon" />, onClick: () => toggleFocusLine(), inline: 'desktop', menu: 'upto-tablet', on: focusParaIndex >= 0 },
                  { key: 'flag', title: isCurrentParaBookmarked ? 'Bỏ cờ tại dòng này (F)' : 'Cắm cờ tại dòng đang đọc (F)', icon: <Flag size={18} fill={isCurrentParaBookmarked ? 'currentColor' : 'none'} />, onClick: toggleBookmark, inline: 'phone', on: isCurrentParaBookmarked },
                  { key: 'bookmarks', title: 'Danh sách cờ đã cắm (M)', icon: <XhIcon name="talisman" />, onClick: () => setShowBookmarks(true), inline: 'desktop', menu: 'upto-tablet' },
                  { key: 'toc', title: 'Mục lục chương (C)', icon: <XhIcon name="scroll" />, onClick: () => setShowTOC(true), inline: 'phone' },
                  { key: 'settings', title: 'Cài đặt giao diện (S)', icon: <XhIcon name="jade" />, onClick: () => setShowSettings(true), inline: 'phone' },
                  { key: 'shortcuts', title: 'Phím tắt (?)', icon: <Keyboard size={19} />, onClick: () => setShowShortcuts(true), inline: 'desktop' },
                  { key: 'download', title: 'Tải file EPUB về máy', icon: <Download size={19} />, onClick: (e) => handleDownloadBook(currentBook, e), inline: 'desktop', menu: 'upto-tablet' },
                  { key: 'edit', title: 'Sửa nội dung chương (E)', icon: <Edit3 size={19} />, onClick: openChapterEditor, inline: 'desktop', menu: 'upto-tablet' },
                  { key: 'fullscreen', title: 'Toàn màn hình', icon: isFullscreen ? <Minimize size={19} /> : <Maximize size={19} />, onClick: toggleFullscreen, inline: 'desktop', menu: 'tablet-only' },
                ];
                return (
                  <div className="tb-actions">
                    {actions.map((a) => (
                      <button
                        key={a.key}
                        className={`btn btn-icon tb-from-${a.inline} ${a.on ? 'flag-on' : ''}`}
                        disabled={a.disabled}
                        onClick={a.onClick}
                        title={a.title}
                      >
                        {a.icon}
                      </button>
                    ))}
                    <div className="tb-more-wrap">
                      <button
                        className="btn btn-icon tb-more"
                        aria-haspopup="menu"
                        aria-expanded={showMoreMenu}
                        onClick={() => setShowMoreMenu(v => !v)}
                        title="Thêm chức năng"
                      >
                        <MoreHorizontal size={20} />
                      </button>
                      {showMoreMenu && (
                        <div className="tb-menu" role="menu" aria-label="Thêm chức năng">
                          {actions.filter((a) => a.menu).map((a) => (
                            <button
                              key={a.key}
                              role="menuitem"
                              className={`tb-menu-item tbm-${a.menu} ${a.on ? 'flag-on' : ''}`}
                              onClick={(e) => { setShowMoreMenu(false); a.onClick(e); }}
                            >
                              {a.icon}
                              <span>{a.title}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </header>
          {!headerVisible && (
            <button
              type="button"
              className="header-reveal-tab"
              aria-label="Hiện thanh công cụ"
              onClick={() => { upDistRef.current = 0; setHeaderVisible(true); }}
            >
              <ChevronDown size={16} />
            </button>
          )}

          <main className="reader-content-box">
            <div className="xh-title-row" aria-hidden="true">
              <span className="xh-rule" />
              <XhIcon name="sword" />
              <span className="xh-rule right" />
            </div>
            <h1 className="chapter-header-title">{currentChapter.title}</h1>
            <div
              className={`reader-body ${settings.font} ${settings.justify ? 'text-justify' : 'text-left'} ${settings.indent !== false ? 'has-indent' : ''} ${settings.allowSelect ? 'allow-select' : 'no-select'}`}
              onClick={handleReaderTap}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onContextMenu={handleContextMenu}
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
            <span>
              <XhIcon name="swordqi" style={{ marginRight: 6 }} />
              {currentChapter.title}
            </span>
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
                  {[
                    { id: 'white', cls: 'theme-paper', name: 'Bạch Ngọc' },
                    { id: 'sepia', cls: 'theme-sepia', name: 'Hoàng Ngọc' },
                    { id: 'slate', cls: 'theme-dark', name: 'Huyền Thiết' },
                    { id: 'oled', cls: 'theme-oled', name: 'U Minh' },
                    { id: 'jade', cls: 'theme-jade', name: 'Thanh Liên' },
                    { id: 'ink', cls: 'theme-ink', name: 'Mặc Họa' }
                  ].map(t => (
                    <div
                      key={t.id}
                      className={`theme-badge ${t.cls} ${settings.theme === t.id ? 'active' : ''}`}
                      onClick={() => setSettings(s => ({ ...s, theme: t.id }))}
                    >
                      {t.name}
                    </div>
                  ))}
                </div>

                <label className="settings-label">Font Chữ</label>
                <div className="font-options">
                  {[
                    { id: 'font-athelas', name: 'Athelas (Sách iOS)' },
                    { id: 'font-palatino', name: 'Palatino' },
                    { id: 'font-charter', name: 'Charter' },
                    { id: 'font-lora', name: 'Lora' },
                    { id: 'font-literata', name: 'Literata' },
                    { id: 'font-merriweather', name: 'Merriweather' },
                    { id: 'font-noto-serif', name: 'Noto Serif' },
                    { id: 'font-be-vietnam', name: 'Be Vietnam Pro' },
                    { id: 'font-inter', name: 'Inter' }
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

                <label className="settings-label cultivation-toggle">
                  <input
                    type="checkbox"
                    checked={!cultivation || cultivation.enabled}
                    onChange={(e) => handleToggleCultivation(e.target.checked)}
                  />
                  {' '}Hệ thống tu tiên
                </label>

                <label className="settings-label">Cỡ Chữ: {settings.fontSize}px</label>
                <div className="setting-range-row">
                  <button
                    className="size-btn"
                    onClick={() => setSettings(s => ({ ...s, fontSize: Math.max(14, s.fontSize - 1) }))}
                  >
                    A-
                  </button>
                  <input
                    type="range"
                    min="14"
                    max="34"
                    step="1"
                    value={settings.fontSize}
                    onChange={(e) => setSettings(s => ({ ...s, fontSize: parseInt(e.target.value, 10) }))}
                  />
                  <button
                    className="size-btn"
                    onClick={() => setSettings(s => ({ ...s, fontSize: Math.min(34, s.fontSize + 1) }))}
                  >
                    A+
                  </button>
                </div>

                <label className="settings-label">Khoảng Cách Chữ: {settings.letterSpacing}px</label>
                <div className="setting-range-row">
                  <button
                    className="size-btn"
                    onClick={() => setSettings(s => ({ ...s, letterSpacing: Math.max(0, +(s.letterSpacing - 0.25).toFixed(2)) }))}
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="4"
                    step="0.25"
                    value={settings.letterSpacing}
                    onChange={(e) => setSettings(s => ({ ...s, letterSpacing: parseFloat(e.target.value) }))}
                  />
                  <button
                    className="size-btn"
                    onClick={() => setSettings(s => ({ ...s, letterSpacing: Math.min(4, +(s.letterSpacing + 0.25).toFixed(2)) }))}
                  >
                    +
                  </button>
                </div>

                <label className="settings-label">Giãn Dòng: {settings.lineHeight.toFixed(2)}</label>
                <div className="setting-range-row">
                  <button
                    className="size-btn"
                    onClick={() => setSettings(s => ({ ...s, lineHeight: Math.max(1.2, +(s.lineHeight - 0.05).toFixed(2)) }))}
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min="1.2"
                    max="2.6"
                    step="0.05"
                    value={settings.lineHeight}
                    onChange={(e) => setSettings(s => ({ ...s, lineHeight: parseFloat(e.target.value) }))}
                  />
                  <button
                    className="size-btn"
                    onClick={() => setSettings(s => ({ ...s, lineHeight: Math.min(2.6, +(s.lineHeight + 0.05).toFixed(2)) }))}
                  >
                    +
                  </button>
                </div>

                <label className="settings-label">Bề Rộng Trang: {settings.maxWidth}px</label>
                <div className="setting-range-row">
                  <button
                    className="size-btn"
                    onClick={() => setSettings(s => ({ ...s, maxWidth: Math.max(520, s.maxWidth - 40) }))}
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min="520"
                    max="1200"
                    step="20"
                    value={settings.maxWidth}
                    onChange={(e) => setSettings(s => ({ ...s, maxWidth: parseInt(e.target.value, 10) }))}
                  />
                  <button
                    className="size-btn"
                    onClick={() => setSettings(s => ({ ...s, maxWidth: Math.min(1200, s.maxWidth + 40) }))}
                  >
                    +
                  </button>
                </div>

                <label className="settings-label">Căn Lề Chữ</label>
                <div className="toggle-row">
                  <button
                    className={`setting-toggle ${settings.justify ? 'active' : ''}`}
                    onClick={() => setSettings(s => ({ ...s, justify: true }))}
                  >
                    Căn Đều 2 Bên
                  </button>
                  <button
                    className={`setting-toggle ${!settings.justify ? 'active' : ''}`}
                    onClick={() => setSettings(s => ({ ...s, justify: false }))}
                  >
                    Căn Trái
                  </button>
                </div>

                <label className="settings-label">Thụt Đầu Dòng (Chuẩn Sách)</label>
                <div className="toggle-row">
                  <button
                    className={`setting-toggle ${settings.indent !== false ? 'active' : ''}`}
                    onClick={() => setSettings(s => ({ ...s, indent: true }))}
                  >
                    Có Thụt Dòng
                  </button>
                  <button
                    className={`setting-toggle ${settings.indent === false ? 'active' : ''}`}
                    onClick={() => setSettings(s => ({ ...s, indent: false }))}
                  >
                    Không Thụt
                  </button>
                </div>

                <label className="settings-label">Bôi Đen Chữ</label>
                <div className="toggle-row">
                  <button
                    className={`setting-toggle ${!settings.allowSelect ? 'active' : ''}`}
                    onClick={() => setSettings(s => ({ ...s, allowSelect: false }))}
                  >
                    Tắt (nhấn 2 lần để ghim)
                  </button>
                  <button
                    className={`setting-toggle ${settings.allowSelect ? 'active' : ''}`}
                    onClick={() => setSettings(s => ({ ...s, allowSelect: true }))}
                  >
                    Cho phép bôi đen
                  </button>
                </div>

                <button
                  className="settings-reset-btn"
                  style={{ marginTop: '0.75rem' }}
                  onClick={() => { setShowSettings(false); setShowShortcuts(true); }}
                >
                  Xem Phím Tắt & Cử Chỉ
                </button>

                <button
                  className="settings-reset-btn"
                  onClick={() => setSettings({ theme: settings.theme, font: 'font-athelas', fontSize: 19, lineHeight: 1.8, letterSpacing: 0, maxWidth: 820, justify: true, indent: true, allowSelect: false })}
                >
                  Khôi Phục Mặc Định
                </button>
              </div>
            </div>
          </div>

          {/* SHORTCUTS DRAWER */}
          <div className={`drawer-overlay ${showShortcuts ? 'open' : ''}`} onClick={() => setShowShortcuts(false)}>
            <div className="drawer" onClick={(e) => e.stopPropagation()}>
              <div className="drawer-header">
                <h3>Phím Tắt & Thao Tác</h3>
                <button className="btn btn-icon" onClick={() => setShowShortcuts(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="settings-section">
                <label className="settings-label">Cử chỉ trên màn hình</label>
                <div className="shortcut-row">
                  <span className="shortcut-desc">Nhấn 2 lần vào một dòng</span>
                  <span className="shortcut-key">Ghim sáng dòng đó</span>
                </div>
                <div className="shortcut-row">
                  <span className="shortcut-desc">Nhấn 1 lần vào một dòng</span>
                  <span className="shortcut-key">Mở menu cắm cờ / sao chép</span>
                </div>
                <div className="shortcut-row">
                  <span className="shortcut-desc">Vuốt ngang</span>
                  <span className="shortcut-key">Chương trước / sau</span>
                </div>

                <label className="settings-label">Bàn phím khi đang đọc</label>
                {[
                  ['→ / PageDown / Space', 'Chương tiếp theo'],
                  ['← / PageUp', 'Chương trước'],
                  ['F', 'Cắm / bỏ cờ ở dòng đang đọc'],
                  ['H', 'Ghim sáng dòng đang đọc'],
                  ['C', 'Mở mục lục chương'],
                  ['M', 'Danh sách cờ đã cắm'],
                  ['S', 'Cài đặt giao diện'],
                  ['J', 'Bật / tắt căn đều 2 bên'],
                  ['+ / −', 'Tăng / giảm cỡ chữ'],
                  ['?', 'Bảng phím tắt này'],
                  ['E', 'Sửa nội dung chương'],
                  ['Esc', 'Đóng mọi bảng'],
                  ['Backspace', 'Về thư viện'],
                  ['F11', 'Toàn màn hình']
                ].map(([keys, desc]) => (
                  <div key={keys} className="shortcut-row">
                    <span className="shortcut-key">{keys}</span>
                    <span className="shortcut-desc">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* QUICK ACTION SHEET (nhấn 1 lần vào dòng) */}
          {selectedPara && (
            <div className="quick-sheet-backdrop" onClick={() => setSelectedPara(null)}>
              <div className="quick-sheet" onClick={(e) => e.stopPropagation()}>
                <div className="quick-sheet-excerpt">{selectedPara.excerpt}…</div>
                <div className="quick-sheet-actions">
                  <button className="quick-action" onClick={flagSelectedPara}>
                    <Flag size={17} fill={selectedPara.bookmarked ? 'currentColor' : 'none'} />
                    <span>{selectedPara.bookmarked ? 'Bỏ cờ dòng này' : 'Cắm cờ dòng này'}</span>
                  </button>
                  <button className="quick-action" onClick={() => { toggleFocusLine(selectedPara.para); setSelectedPara(null); }}>
                    <Highlighter size={17} />
                    <span>Ghim sáng dòng</span>
                  </button>
                  <button className="quick-action" onClick={copySelectedPara}>
                    <Copy size={17} />
                    <span>Sao chép đoạn</span>
                  </button>
                  <button className="quick-action" onClick={handleStartEditPara}>
                    <Edit3 size={17} />
                    <span>Sửa đoạn văn</span>
                  </button>
                </div>
                <button className="quick-sheet-close" onClick={() => setSelectedPara(null)}>Đóng</button>
              </div>
            </div>
          )}
          <div className={`drawer-overlay ${showBookmarks ? 'open' : ''}`} onClick={() => setShowBookmarks(false)}>
            <div className="drawer" onClick={(e) => e.stopPropagation()}>
              <div className="drawer-header">
                <h3>Cờ Đánh Dấu ({bookmarks.length})</h3>
                <button className="btn btn-icon" onClick={() => setShowBookmarks(false)}>
                  <X size={20} />
                </button>
              </div>

              {bookmarks.length === 0 ? (
                <div className="bookmark-empty">
                  <Flag size={34} />
                  <p>Chưa có vị trí nào được đánh dấu.</p>
                  <span>Bấm biểu tượng cờ trên thanh công cụ để lưu lại vị trí đang đọc.</span>
                </div>
              ) : (
                <div className="toc-list">
                  {bookmarks.map((bm) => (
                    <div
                      key={bm.id}
                      className={`bookmark-item ${bm.chapter_index === chapterIndex ? 'current' : ''}`}
                      onClick={() => jumpToBookmark(bm)}
                    >
                      <div className="bookmark-item-body">
                        <div className="bookmark-item-title">
                          <Flag size={13} style={{ flexShrink: 0 }} />
                          <span>Chương {bm.chapter_index}</span>
                          <span className="bookmark-item-pct">{Math.round(bm.scroll_percent || 0)}%</span>
                        </div>
                        {bm.excerpt && (
                          <div className="bookmark-item-excerpt">{bm.excerpt}</div>
                        )}
                      </div>
                      <button
                        className="bookmark-remove-btn"
                        title="Bỏ cờ này"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeBookmark(bm);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TEXT EDIT MODAL (Sửa văn bản khi đang đọc) */}
      {editModal && (
        <div className="edit-modal-overlay" onClick={() => setEditModal(null)}>
          <div className="edit-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="edit-modal-header">
              <div className="edit-modal-title">
                <Edit3 size={18} />
                <span>{editModal.type === 'para' ? 'Sửa Đoạn Văn' : 'Chỉnh Sửa Toàn Bộ Chương'}</span>
              </div>
              <button className="btn btn-icon" onClick={() => setEditModal(null)}>
                <X size={20} />
              </button>
            </div>

            <div className="edit-modal-body">
              {editModal.type === 'chapter' && (
                <div className="edit-field-group">
                  <label className="edit-field-label">Tiêu đề chương</label>
                  <input
                    type="text"
                    className="edit-title-input"
                    value={editModal.title}
                    onChange={(e) => setEditModal(m => ({ ...m, title: e.target.value }))}
                    placeholder="Tiêu đề chương..."
                  />
                </div>
              )}

              <div className="edit-field-group" style={{ flex: 1 }}>
                <label className="edit-field-label">
                  {editModal.type === 'para' ? 'Nội dung đoạn văn' : 'Nội dung văn bản (mỗi đoạn cách nhau một dòng trống)'}
                </label>
                <textarea
                  className="edit-textarea"
                  value={editModal.text}
                  onChange={(e) => setEditModal(m => ({ ...m, text: e.target.value }))}
                  placeholder="Nhập nội dung văn bản..."
                  rows={editModal.type === 'para' ? 6 : 14}
                  autoFocus
                />
              </div>
            </div>

            <div className="edit-modal-footer">
              <span className="edit-modal-hint">
                {editModal.type === 'para' ? 'Vị trí trang đọc được giữ nguyên sau khi lưu' : 'Được đồng bộ tự động lên đám mây'}
              </span>
              <button className="btn btn-secondary" onClick={() => setEditModal(null)}>
                Hủy
              </button>
              <button className="btn btn-primary" onClick={handleSaveEditModal}>
                <Check size={16} /> Lưu Thay Đổi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GLOBAL TOP ACTION PROGRESS BAR */}
      {topProgress !== null && (
        <div
          className="global-top-progress-bar"
          style={{
            width: `${topProgress}%`,
            opacity: topProgress === 100 ? 0 : 1
          }}
        />
      )}

      {/* UPLOAD PROGRESS OVERLAY */}
      {uploadProgress && (
        <div className="loading-overlay">
          <div className="upload-progress-card">
            <div className="upload-icon-pulse">
              <UploadCloud size={30} />
            </div>
            <h4 className="upload-title">Đang tải sách lên</h4>
            <p className="upload-filename" title={uploadProgress.fileName}>
              {uploadProgress.fileName}
            </p>

            <div className="upload-bar-track">
              <div
                className="upload-bar-fill"
                style={{ width: `${uploadProgress.percent}%` }}
              />
            </div>

            <div className="upload-stats">
              <span className="upload-percent">{uploadProgress.percent}%</span>
              {uploadProgress.total > 0 && (
                <span className="upload-bytes">
                  {(uploadProgress.loaded / (1024 * 1024)).toFixed(1)} MB / {(uploadProgress.total / (1024 * 1024)).toFixed(1)} MB
                </span>
              )}
            </div>

            <div className="upload-status-row">
              {uploadProgress.percent >= 99 && uploadProgress.percent < 100 && (
                <div className="spinner-sm" />
              )}
              <span className="upload-status-text">{uploadProgress.statusText}</span>
            </div>
          </div>
        </div>
      )}

      {showRealmPath && cultivation && (
        <RealmPath cultivation={cultivation} onClose={() => setShowRealmPath(false)} />
      )}

      {breakthrough && (
        <div className={`breakthrough-banner buoc-${breakthrough.buoc}`} role="status" aria-live="polite">
          <RealmIcon name={breakthrough.name} size={26} />
          <span><strong>Đột phá!</strong> {breakthrough.name} · tầng {breakthrough.tang}</span>
        </div>
      )}

      {prepProgress && (
        <div className="prep-pill" role="status" aria-live="polite">
          Đang chuẩn bị chương: {prepProgress.done}/{prepProgress.total}
        </div>
      )}

      {/* TOAST POPUP */}
      <div className={`toast-msg ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
