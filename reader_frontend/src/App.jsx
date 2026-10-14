import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  BookOpen, Search, Plus, Trash2, ArrowLeft, ArrowRight,
  List, Sliders, Maximize, Minimize, X, History,
  PlayCircle, User, LogOut, UploadCloud, Flag, Highlighter, Keyboard, Copy
} from 'lucide-react';
import AuthPage from './AuthPage';
import XhIcon, { XhSprite } from './XhIcon';
import { getApiUrl } from './api';

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
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [tocSearch, setTocSearch] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Bookmarks (Cờ đánh dấu vị trí đọc) + exact paragraph tracking
  const [bookmarks, setBookmarks] = useState([]);
  const [activeParaIndex, setActiveParaIndex] = useState(0);
  const [focusParaIndex, setFocusParaIndex] = useState(-1);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedPara, setSelectedPara] = useState(null);

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
        return parsed;
      } catch (e) {}
    }
    return {
      theme: 'sepia',
      font: 'font-literata',
      fontSize: 19,
      lineHeight: 1.8,
      letterSpacing: 0,
      maxWidth: 820,
      justify: true,
      allowSelect: false
    };
  });

  const lastScrollTopRef = useRef(0);
  const scrollTimeoutRef = useRef(null);
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const pendingRestoreRef = useRef(null);
  const focusParaRef = useRef(-1);
  const focusChapterRef = useRef(-1);
  const tapRef = useRef({ para: -1, time: 0 });
  const tapTimerRef = useRef(null);
  const shortcutsRef = useRef({});
  const settingsTimeoutRef = useRef(null);
  const lastSavedSettingsRef = useRef(null);

  const showToast = useCallback((msg, ms = 3000) => {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  }, []);

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
    if (cloudToken && serialized !== lastSavedSettingsRef.current) {
      clearTimeout(settingsTimeoutRef.current);
      settingsTimeoutRef.current = setTimeout(async () => {
        try {
          await fetch(getApiUrl('/api/settings'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${cloudToken}`
            },
            body: JSON.stringify({ settings })
          });
          lastSavedSettingsRef.current = serialized;
        } catch (e) {}
      }, 600);
    }
  }, [settings, cloudToken]);

  // ---------------------------------------------------------------------------
  // DATA LOADING (AUTO SYNC FROM CLOUDFLARE D1)
  // ---------------------------------------------------------------------------

  const loadUserData = useCallback(async (token) => {
    if (!token) return;
    setLoading(true);
    try {
      const headers = { 'Authorization': `Bearer ${token}` };

      // 1. Fetch Books
      const booksRes = await fetch(getApiUrl('/api/books'), { headers });
      if (booksRes.status === 401) {
        handleLogout();
        return;
      }
      if (booksRes.ok) {
        const booksData = await booksRes.json();
        setBooks(booksData);
      }

      // 2. Fetch Multi-Book Reading History
      const histRes = await fetch(getApiUrl('/api/history'), { headers });
      if (histRes.ok) {
        const histData = await histRes.json();
        setHistory(histData);
      }

      // 3. Fetch Reader Settings from Cloud
      const settingsRes = await fetch(getApiUrl('/api/settings'), { headers });
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
    showToast(`Đang tải sách lên: ${file.name}...`);
    setLoading(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(getApiUrl('/api/books/upload'), {
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
        const res = await fetch(getApiUrl(`/api/books/${book.id}`), {
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

  const openBook = async (bookId, targetChapter = 1, restoreScroll = 0, restorePara = null) => {
    showToast('Đang mở sách...');
    setLoading(true);

    try {
      const res = await fetch(getApiUrl(`/api/books/${bookId}`), {
        headers: { 'Authorization': `Bearer ${cloudToken}` }
      });
      if (!res.ok) throw new Error('Không thể tải thông tin sách.');
      const bookData = await res.json();

      setCurrentBook(bookData);
      setChapterIndex(targetChapter);
      setView('reader');
      window.scrollTo({ top: 0, behavior: 'instant' });

      await loadBookmarks(bookId);

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
      setLoading(false);
    }
  };

  const loadChapter = async (bookId, idx, restoreScroll = 0, explicitTitle = null, restorePara = null, restoreFocus = null, restoreFocusChapter = null) => {
    try {
      const res = await fetch(getApiUrl(`/api/books/${bookId}/chapters/${idx}`), {
        headers: { 'Authorization': `Bearer ${cloudToken}` }
      });
      if (!res.ok) throw new Error('Không thể tải nội dung chương.');
      const data = await res.json();

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

  const loadBookmarks = async (bookId) => {
    try {
      const res = await fetch(getApiUrl(`/api/books/${bookId}/bookmarks`), {
        headers: { 'Authorization': `Bearer ${cloudToken}` }
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
          'Authorization': `Bearer ${cloudToken}`
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

  const toggleFocusLine = (paraIdx) => {
    const target = Number.isFinite(paraIdx) ? paraIdx : getActiveParaIndex();
    const isSamePin = focusChapterRef.current === chapterIndex && focusParaRef.current === target;
    const next = isSamePin ? -1 : target;
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
      showToast('Đã ghim dòng đang đọc');
    } else {
      showToast('Đã bỏ ghim dòng');
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
          'Authorization': `Bearer ${cloudToken}`
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
    if (!cloudToken || !bookId) return;
    try {
      const bTitle = explicitBookTitle || currentBook?.record?.title || currentBook?.title || 'Sách';
      const focusIdx = focusPara === null ? focusParaRef.current : focusPara;
      const focusChap = focusChapter === null ? focusChapterRef.current : focusChapter;
      await fetch(getApiUrl(`/api/books/${bookId}/progress`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cloudToken}`
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

  // Nhấn 2 lần vào một dòng: ghim sáng dòng đó. Nhấn 1 lần: mở menu thao tác nhanh.
  // Một cú nhấn đúp của trình duyệt phát ra 2 sự kiện 'click' liên tiếp, nên chỉ
  // cần đếm click và huỷ bộ đếm của lần nhấn trước -> không bao giờ mở nhầm menu.
  const handleReaderTap = (e) => {
    const target = e.target.closest('.reader-body [data-p]');
    if (!target) return;
    const paraIdx = parseInt(target.getAttribute('data-p'), 10);
    if (!Number.isFinite(paraIdx)) return;

    const now = Date.now();
    const prev = tapRef.current;

    if (prev.para === paraIdx && now - prev.time < 450) {
      // Nhấn lần 2 trên cùng dòng -> ghim sáng, huỷ menu đang chờ
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      tapRef.current = { para: -1, time: 0 };
      setSelectedPara(null);
      toggleFocusLine(paraIdx);
      return;
    }

    tapRef.current = { para: paraIdx, time: now };
    clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => {
      tapTimerRef.current = null;
      if (tapRef.current.para === paraIdx) {
        openSelectionMenu(paraIdx);
      }
    }, 450);
  };

  const handleTouchStart = (e) => {
    touchStartXRef.current = e.changedTouches[0].screenX;
    touchStartYRef.current = e.changedTouches[0].screenY;
  };

  const handleTouchEnd = (e) => {
    if (view !== 'reader') return;
    if (showSettings || showTOC || showBookmarks || e.target?.closest?.('input, button, .drawer')) return;
    const diffX = e.changedTouches[0].screenX - touchStartXRef.current;
    const diffY = e.changedTouches[0].screenY - touchStartYRef.current;
    const absX = Math.abs(diffX);
    const absY = Math.abs(diffY);
    // Phải là vuốt NGANG rõ ràng: đủ xa VÀ ngang phải trội hơn dọc ít nhất gấp
    // đôi. Trước đây chỉ cần |X| > 70 và |Y| < 50 nên một cú vuốt hơi chéo
    // (ngang 80, dọc 45) vẫn bị tính là chuyển chương - rất dễ nhảy chương
    // ngoài ý muốn khi đang cuộn dọc.
    if (absX > 70 && absX > absY * 2) {
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
    shortcuts: () => setShowShortcuts(v => !v),
    back: () => {
      setView('library');
      loadUserData(cloudToken);
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

  const isCurrentParaBookmarked = bookmarks.some(
    b => b.chapter_index === chapterIndex && b.para_index === activeParaIndex
  );

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <XhSprite />
      {view === 'library' && (
        <>
          <header className="header">
            <div className="header-inner">
              <div className="brand" onClick={() => loadUserData(cloudToken)}>
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
                        src={getApiUrl(`/api/books/${item.book_id}/cover`)}
                          alt={item.book_title}
                          className="history-cover"
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
                          src={getApiUrl(`/api/books/${book.id}/cover`)}
                            alt={book.title}
                            className="book-cover-img"
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
                  loadUserData(cloudToken);
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

              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className={`btn btn-icon ${focusParaIndex >= 0 ? 'flag-on' : ''}`}
                  onClick={() => toggleFocusLine()}
                  title="Ghim sáng dòng đang đọc (H)"
                >
                  <XhIcon name="moon" />
                </button>
                <button
                  className={`btn btn-icon ${isCurrentParaBookmarked ? 'flag-on' : ''}`}
                  onClick={toggleBookmark}
                  title={isCurrentParaBookmarked ? 'Bỏ cờ tại dòng này (F)' : 'Cắm cờ tại dòng đang đọc (F)'}
                >
                  <Flag size={18} fill={isCurrentParaBookmarked ? 'currentColor' : 'none'} />
                </button>
                <button
                  className="btn btn-icon"
                  onClick={() => setShowBookmarks(true)}
                  title="Danh sách cờ đã cắm (M)"
                >
                  <XhIcon name="talisman" />
                </button>
                <button className="btn btn-icon" onClick={() => setShowTOC(true)} title="Mục lục chương (C)">
                  <XhIcon name="scroll" />
                </button>
                <button className="btn btn-icon" onClick={() => setShowSettings(true)} title="Cài đặt giao diện (S)">
                  <XhIcon name="jade" />
                </button>
                <button className="btn btn-icon hide-on-mobile" onClick={() => setShowShortcuts(true)} title="Phím tắt (?)">
                  <Keyboard size={19} />
                </button>
                <button className="btn btn-icon hide-on-mobile" onClick={toggleFullscreen} title="Toàn màn hình">
                  {isFullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
                </button>
              </div>
            </div>
          </header>

          <main className="reader-content-box">
            <div className="xh-title-row" aria-hidden="true">
              <span className="xh-rule" />
              <XhIcon name="sword" />
              <span className="xh-rule right" />
            </div>
            <h1 className="chapter-header-title">{currentChapter.title}</h1>
            <div
              className={`reader-body ${settings.font} ${settings.justify ? 'text-justify' : 'text-left'} ${settings.allowSelect ? 'allow-select' : 'no-select'}`}
              onClick={handleReaderTap}
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
                    { id: 'font-literata', name: 'Literata' },
                    { id: 'font-noto-serif-display', name: 'Noto Serif Display' },
                    { id: 'font-merriweather', name: 'Merriweather' },
                    { id: 'font-lora', name: 'Lora' },
                    { id: 'font-eb-garamond', name: 'EB Garamond' },
                    { id: 'font-cormorant', name: 'Cormorant Garamond' },
                    { id: 'font-playfair', name: 'Playfair Display' },
                    { id: 'font-spectral', name: 'Spectral' },
                    { id: 'font-vollkorn', name: 'Vollkorn' },
                    { id: 'font-source-serif', name: 'Source Serif 4' },
                    { id: 'font-alegreya', name: 'Alegreya' },
                    { id: 'font-crimson', name: 'Crimson Pro' },
                    { id: 'font-gelasio', name: 'Gelasio' },
                    { id: 'font-petrona', name: 'Petrona' },
                    { id: 'font-noticia', name: 'Noticia Text' },
                    { id: 'font-faustina', name: 'Faustina' },
                    { id: 'font-bitter', name: 'Bitter' },
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
                  onClick={() => setSettings({ theme: settings.theme, font: 'font-literata', fontSize: 19, lineHeight: 1.8, letterSpacing: 0, maxWidth: 820, justify: true, allowSelect: false })}
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

      {/* LOADING OVERLAY */}
      {loading && (
        <div className="loading-overlay">
          <div className="loading-card">
            <div className="spinner"></div>
            <p style={{ marginTop: 14, fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
              Đang xử lý và tải sách lên...
            </p>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Vui lòng đợi trong giây lát
            </span>
          </div>
        </div>
      )}

      {/* TOAST POPUP */}
      <div className={`toast-msg ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
