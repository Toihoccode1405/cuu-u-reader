/**
 * =============================================================================
 * CỬU U THƯ CÁC - FRONTEND ENGINE
 * Full-featured mobile + PC web novel reader
 * =============================================================================
 */

const API_BASE = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
  ? ''
  : ''; // relative path for Cloudflare Tunnel / reverse proxy

// State
let appState = {
  books: [],
  currentBook: null,
  currentChapterIndex: 1,
  currentChapterTotal: 1,
  readingScrollTimer: null,
  isHeaderHidden: false,
  lastScrollTop: 0,
  settings: {
    theme: 'sepia',
    font: 'font-literata',
    fontSize: 19,
    lineHeight: 1.75,
    maxWidth: 820,
    align: 'justify'
  }
};

// =============================================================================
// 1. INITIALIZATION & SETTINGS
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
  loadStoredSettings();
  initEventListeners();
  loadLibrary();
});

function loadStoredSettings() {
  try {
    const saved = localStorage.getItem('cuu_u_reader_settings');
    if (saved) {
      appState.settings = { ...appState.settings, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.warn('Cannot load settings:', e);
  }
  applySettings();
}

function saveSettings() {
  try {
    localStorage.setItem('cuu_u_reader_settings', JSON.stringify(appState.settings));
  } catch (e) {
    console.warn('Cannot save settings:', e);
  }
}

function applySettings() {
  const s = appState.settings;

  // Apply Theme
  document.documentElement.setAttribute('data-theme', s.theme);
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === s.theme);
  });

  // Apply Font
  const content = document.getElementById('reading-content');
  if (content) {
    content.className = `reading-content ${s.font} ${s.align === 'left' ? 'text-align-left' : ''}`;
  }
  document.querySelectorAll('.font-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.font === s.font);
  });

  // Apply Typography CSS Variables
  document.documentElement.style.setProperty('--reader-font-size', `${s.fontSize}px`);
  document.documentElement.style.setProperty('--reader-line-height', s.lineHeight);
  document.documentElement.style.setProperty('--max-content-width', `${s.maxWidth}px`);

  // Update UI Inputs
  const fontSlider = document.getElementById('slider-font-size');
  if (fontSlider) fontSlider.value = s.fontSize;
  const fontVal = document.getElementById('font-size-val');
  if (fontVal) fontVal.textContent = `${s.fontSize}px`;

  const lhSlider = document.getElementById('slider-line-height');
  if (lhSlider) lhSlider.value = s.lineHeight;
  const lhVal = document.getElementById('line-height-val');
  if (lhVal) lhVal.textContent = s.lineHeight;

  const widthSlider = document.getElementById('slider-max-width');
  if (widthSlider) widthSlider.value = s.maxWidth;
  const widthVal = document.getElementById('max-width-val');
  if (widthVal) widthVal.textContent = `${s.maxWidth}px`;

  document.querySelectorAll('.align-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.align === s.align);
  });
}

// =============================================================================
// 2. LIBRARY LOGIC (TỦ SÁCH)
// =============================================================================

async function loadLibrary() {
  try {
    const res = await fetch(`${API_BASE}/api/books`);
    if (!res.ok) throw new Error('Không thể tải danh sách sách');
    appState.books = await res.json();
    renderLibrary();
  } catch (e) {
    showToast('Lỗi kết nối máy chủ: ' + e.message);
  }
}

function renderLibrary(filteredBooks = null) {
  const books = filteredBooks || appState.books;
  const grid = document.getElementById('books-grid');
  const emptyState = document.getElementById('empty-state');
  const countEl = document.getElementById('book-count');

  if (countEl) countEl.textContent = books.length;

  if (books.length === 0) {
    grid.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  grid.innerHTML = books.map(book => {
    const percent = Math.round((book.current_chapter / Math.max(1, book.total_chapters)) * 100);
    const coverHtml = book.has_cover
      ? `<img src="${API_BASE}/api/books/${book.id}/cover" alt="${escapeHtml(book.title)}" loading="lazy">`
      : `<div class="book-cover-placeholder">
           <div class="icon">📖</div>
           <div class="text-title">${escapeHtml(book.title)}</div>
         </div>`;

    return `
      <div class="book-card" onclick="openBook('${book.id}', ${book.current_chapter || 1})">
        <button class="book-delete-btn" onclick="event.stopPropagation(); confirmDeleteBook('${book.id}', '${escapeHtml(book.title)}')" title="Xóa sách">✕</button>
        <div class="book-cover">
          ${coverHtml}
        </div>
        <div class="book-info">
          <div class="book-title" title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</div>
          <div class="book-author">${escapeHtml(book.author || 'Khuyết danh')}</div>
          <div class="book-meta">
            <span>Chương ${book.current_chapter}/${book.total_chapters}</span>
            <span>${percent}%</span>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar-fill" style="width: ${percent}%;"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function handleFileUpload(file) {
  if (!file || !file.name.toLowerCase().endsWith('.epub')) {
    showToast('Vui lòng chọn file định dạng .epub');
    return;
  }

  showToast(`Đang tải lên và phân tích: ${file.name}...`);
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(`${API_BASE}/api/books/upload`, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || 'Lỗi tải lên');
    }

    const newBook = await res.json();
    showToast(`Đã thêm thành công: ${newBook.title}`);
    await loadLibrary();
  } catch (e) {
    showToast(`Thất bại: ${e.message}`);
  }
}

async function confirmDeleteBook(id, title) {
  if (confirm(`Bạn có chắc muốn xóa cuốn sách "${title}" khỏi thư viện?`)) {
    try {
      const res = await fetch(`${API_BASE}/api/books/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Đã xóa sách khỏi thư viện');
        await loadLibrary();
      } else {
        showToast('Xóa thất bại');
      }
    } catch (e) {
      showToast('Lỗi: ' + e.message);
    }
  }
}

// =============================================================================
// 3. READER LOGIC (ĐỌC SÁCH)
// =============================================================================

async function openBook(bookId, targetChapter = 1) {
  showToast('Đang mở sách...');
  try {
    const res = await fetch(`${API_BASE}/api/books/${bookId}`);
    if (!res.ok) throw new Error('Không thể tải thông tin sách');

    appState.currentBook = await res.json();
    appState.currentChapterIndex = targetChapter;
    appState.currentChapterTotal = appState.currentBook.record.total_chapters;

    // Switch view
    document.getElementById('library-view').classList.replace('view-active', 'view-hidden');
    document.getElementById('reader-view').classList.replace('view-hidden', 'view-active');

    renderTOC();
    await loadChapter(bookId, targetChapter, appState.currentBook.record.scroll_percent);
  } catch (e) {
    showToast('Lỗi mở sách: ' + e.message);
  }
}

function returnToLibrary() {
  document.getElementById('reader-view').classList.replace('view-active', 'view-hidden');
  document.getElementById('library-view').classList.replace('view-hidden', 'view-active');
  closeAllDrawers();
  loadLibrary(); // refresh progress in library cards
}

async function loadChapter(bookId, chapterIndex, restoreScroll = 0) {
  const contentEl = document.getElementById('reading-content');
  const titleHeaderEl = document.getElementById('reader-current-title');
  const indicatorEl = document.getElementById('chapter-progress-indicator');

  contentEl.innerHTML = '<div style="text-align: center; padding: 4rem; opacity: 0.6;">Đang tải nội dung chương...</div>';
  window.scrollTo({ top: 0, behavior: 'instant' });

  try {
    const res = await fetch(`${API_BASE}/api/books/${bookId}/chapters/${chapterIndex}`);
    if (!res.ok) throw new Error('Không thể tải nội dung chương');

    const data = await res.json();
    appState.currentChapterIndex = chapterIndex;

    titleHeaderEl.textContent = data.title;
    indicatorEl.textContent = `Chương ${chapterIndex} / ${data.total_chapters}`;

    contentEl.innerHTML = `
      <h1>${escapeHtml(data.title)}</h1>
      ${data.content_html}
    `;

    // Update buttons state
    document.getElementById('btn-prev-chapter').disabled = !data.prev_index;
    document.getElementById('btn-next-chapter').disabled = !data.next_index;

    // Highlight in TOC
    updateTOCActiveItem(chapterIndex);

    // Restore scroll if needed
    if (restoreScroll > 0) {
      setTimeout(() => {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: maxScroll * (restoreScroll / 100), behavior: 'smooth' });
      }, 100);
    }

    // Save progress to server
    sendProgressToServer(bookId, chapterIndex, 0);
  } catch (e) {
    contentEl.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 4rem;">Lỗi tải chương: ${e.message}</div>`;
  }
}

function renderTOC() {
  const listEl = document.getElementById('toc-list');
  if (!appState.currentBook) return;

  const chapters = appState.currentBook.chapters;
  listEl.innerHTML = chapters.map(ch => `
    <li class="toc-item ${ch.index === appState.currentChapterIndex ? 'active' : ''}" 
        data-index="${ch.index}" 
        onclick="goToChapter(${ch.index})">
      <span>${escapeHtml(ch.title)}</span>
      <span style="opacity: 0.5; font-size: 0.8rem;">#${ch.index}</span>
    </li>
  `).join('');
}

function updateTOCActiveItem(index) {
  document.querySelectorAll('.toc-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.index) === index);
  });
}

function goToChapter(index) {
  closeAllDrawers();
  if (appState.currentBook) {
    loadChapter(appState.currentBook.record.id, index, 0);
  }
}

function prevChapter() {
  if (appState.currentBook && appState.currentChapterIndex > 1) {
    loadChapter(appState.currentBook.record.id, appState.currentChapterIndex - 1, 0);
  }
}

function nextChapter() {
  if (appState.currentBook && appState.currentChapterIndex < appState.currentChapterTotal) {
    loadChapter(appState.currentBook.record.id, appState.currentChapterIndex + 1, 0);
  }
}

// =============================================================================
// 4. DRAWERS & UI CONTROLS
// =============================================================================

function toggleDrawer(drawerId) {
  const drawer = document.getElementById(drawerId);
  const backdrop = document.getElementById('modal-backdrop');
  const isOpen = drawer.classList.contains('active');

  closeAllDrawers();

  if (!isOpen) {
    drawer.classList.add('active');
    backdrop.classList.add('active');
  }
}

function closeAllDrawers() {
  document.querySelectorAll('.drawer').forEach(d => d.classList.remove('active'));
  document.getElementById('modal-backdrop').classList.remove('active');
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

// =============================================================================
// 5. EVENT LISTENERS
// =============================================================================

function initEventListeners() {
  // Navigation
  document.getElementById('btn-back-library').addEventListener('click', returnToLibrary);
  document.getElementById('btn-toggle-toc').addEventListener('click', () => toggleDrawer('toc-drawer'));
  document.getElementById('btn-close-toc').addEventListener('click', closeAllDrawers);
  document.getElementById('btn-toggle-settings').addEventListener('click', () => toggleDrawer('settings-drawer'));
  document.getElementById('btn-close-settings').addEventListener('click', closeAllDrawers);
  document.getElementById('modal-backdrop').addEventListener('click', closeAllDrawers);
  document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);

  document.getElementById('btn-prev-chapter').addEventListener('click', prevChapter);
  document.getElementById('btn-next-chapter').addEventListener('click', nextChapter);

  // Search in Library
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderLibrary();
      return;
    }
    const filtered = appState.books.filter(b => 
      b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
    );
    renderLibrary(filtered);
  });

  // Search in TOC
  const tocSearch = document.getElementById('toc-search-input');
  tocSearch.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('.toc-item').forEach(item => {
      const match = item.textContent.toLowerCase().includes(q);
      item.style.display = match ? 'flex' : 'none';
    });
  });

  // Upload Handlers
  const uploadInput = document.getElementById('epub-upload-input');
  uploadInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  });

  // Drag & Drop
  const dropZone = document.getElementById('drop-zone');
  ['dragenter', 'dragover'].forEach(ev => {
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    });
  });
  dropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  // Typography Controls
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.settings.theme = btn.dataset.theme;
      applySettings();
      saveSettings();
    });
  });

  document.querySelectorAll('.font-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.settings.font = btn.dataset.font;
      applySettings();
      saveSettings();
    });
  });

  const fontSlider = document.getElementById('slider-font-size');
  fontSlider.addEventListener('input', (e) => {
    appState.settings.fontSize = parseInt(e.target.value);
    applySettings();
    saveSettings();
  });
  document.getElementById('btn-font-dec').addEventListener('click', () => {
    if (appState.settings.fontSize > 14) {
      appState.settings.fontSize -= 1;
      applySettings();
      saveSettings();
    }
  });
  document.getElementById('btn-font-inc').addEventListener('click', () => {
    if (appState.settings.fontSize < 32) {
      appState.settings.fontSize += 1;
      applySettings();
      saveSettings();
    }
  });

  const lhSlider = document.getElementById('slider-line-height');
  lhSlider.addEventListener('input', (e) => {
    appState.settings.lineHeight = parseFloat(e.target.value);
    applySettings();
    saveSettings();
  });

  const widthSlider = document.getElementById('slider-max-width');
  widthSlider.addEventListener('input', (e) => {
    appState.settings.maxWidth = parseInt(e.target.value);
    applySettings();
    saveSettings();
  });

  document.querySelectorAll('.align-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.settings.align = btn.dataset.align;
      applySettings();
      saveSettings();
    });
  });

  // Keyboard Shortcuts (Arrow Left / Right for chapters)
  window.addEventListener('keydown', (e) => {
    if (document.getElementById('reader-view').classList.contains('view-active')) {
      if (e.key === 'ArrowLeft') {
        prevChapter();
      } else if (e.key === 'ArrowRight') {
        nextChapter();
      }
    }
  });

  // Touch Swipe on Mobile
  let touchStartX = 0;
  let touchEndX = 0;
  window.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  window.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    if (document.getElementById('reader-view').classList.contains('view-active')) {
      const diff = touchEndX - touchStartX;
      if (Math.abs(diff) > 90) {
        if (diff > 0) prevChapter(); // Swipe right -> previous
        else nextChapter();          // Swipe left -> next
      }
    }
  }, { passive: true });

  // Scroll Progress & Auto-hiding header
  window.addEventListener('scroll', () => {
    if (document.getElementById('reader-view').classList.contains('view-active')) {
      const st = window.pageYOffset || document.documentElement.scrollTop;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const progressPercent = maxScroll > 0 ? (st / maxScroll) * 100 : 0;

      // Update progress bar
      const bar = document.getElementById('scroll-progress-bar');
      if (bar) bar.style.width = `${progressPercent}%`;

      // Auto hide/show header
      const header = document.getElementById('reader-header');
      if (st > appState.lastScrollTop && st > 150) {
        header.classList.add('header-hidden');
      } else {
        header.classList.remove('header-hidden');
      }
      appState.lastScrollTop = st <= 0 ? 0 : st;

      // Debounced save progress
      clearTimeout(appState.readingScrollTimer);
      appState.readingScrollTimer = setTimeout(() => {
        if (appState.currentBook) {
          sendProgressToServer(appState.currentBook.record.id, appState.currentChapterIndex, progressPercent);
        }
      }, 1000);
    }
  }, { passive: true });
}

function sendProgressToServer(bookId, chapterIndex, scrollPercent) {
  fetch(`${API_BASE}/api/books/${bookId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chapter_index: chapterIndex,
      scroll_percent: scrollPercent
    })
  }).catch(() => {});
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}
