// Tách chương: cắt sẵn nội dung từng chương ngay trên trình duyệt rồi gửi lên máy chủ,
// để lần mở chương đầu tiên không phải giải nén EPUB 40MB trên Worker.
// Làm tiếp được nếu bị ngắt (chỉ tách những chương máy chủ chưa có), và không bao giờ ghi đè chương đã có.
import { extractChapterRaw } from '../../shared/epub-chapter.js';
import { findZipFile } from './storage.js';
import { getApiUrl } from './api.js';

const BATCH_MAX_CHAPTERS = 25;
const BATCH_MAX_CHARS = 1_500_000;
const CHAPTER_MAX_CHARS = 490_000; // máy chủ từ chối chương > 500k ký tự

const running = new Set();

async function jsonOrNull(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// getSource: () => Promise<Blob|File|ArrayBuffer>, chỉ gọi khi thật sự còn chương thiếu.
// Trả về số chương đã gửi lên; null nếu sách này đang được tách ở nơi khác.
export async function prepareChapters({ bookId, toc, getSource, onProgress, signal }) {
  if (running.has(bookId)) return null;
  running.add(bookId);
  try {
    const listRes = await fetch(getApiUrl(`/api/books/${bookId}/extracted`), { signal });
    if (!listRes.ok) return 0;
    const listed = await jsonOrNull(listRes);
    const have = new Set((listed && listed.extracted) || []);
    const missing = (toc || []).filter((c) => c && c.href && !have.has(c.index));
    if (!missing.length) return 0;

    const source = await getSource();
    if (!source || signal?.aborted) return 0;
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(source);

    let done = 0;
    let batch = [];
    let batchChars = 0;
    const total = missing.length;
    onProgress?.({ done, total });

    const flush = async () => {
      if (!batch.length) return;
      const res = await fetch(getApiUrl(`/api/books/${bookId}/chapters/batch`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapters: batch }),
        signal,
      });
      if (!res.ok) throw new Error(`Gửi lô chương thất bại (${res.status})`);
      done += batch.length;
      batch = [];
      batchChars = 0;
      onProgress?.({ done, total });
    };

    for (const ch of missing) {
      if (signal?.aborted) return done;
      const raw = await extractChapterRaw(zip, toc, ch.index, ch, findZipFile);
      if (!raw || !raw.trim() || raw.length > CHAPTER_MAX_CHARS) {
        // Để máy chủ tự tách khi người đọc mở chương này
        continue;
      }
      if (batch.length >= BATCH_MAX_CHAPTERS || batchChars + raw.length > BATCH_MAX_CHARS) await flush();
      batch.push({ index: ch.index, raw_html: raw });
      batchChars += raw.length;
    }
    await flush();
    return done;
  } catch (e) {
    if (e && e.name === 'AbortError') return 0;
    console.warn('Tách chương bị gián đoạn:', e);
    return 0;
  } finally {
    running.delete(bookId);
    onProgress?.(null);
  }
}
