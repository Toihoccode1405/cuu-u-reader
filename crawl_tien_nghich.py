#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
Tiên Nghịch (Full 2120 Chương) - Webnovel.vn High-Speed Downloader & EPUB Builder
- Tải đa luồng song song (15-20 workers)
- Hỗ trợ resume (đã tải chương nào thì bỏ qua, không tải lại)
- Tự động đóng gói thành Tien_Nghich.epub chuẩn đầy đủ mục lục
=============================================================================
"""

import os
import re
import sys
import time
import ssl
import html
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from create_epub import build_epub_from_chapters

TOTAL_CHAPTERS = 2120
BASE_URL = "https://webnovel.vn/tien-nghich/chuong-{}/"
OUTPUT_DIR = "chapters_tien_nghich"
COVER_URL = "https://cdn.webnovel.vn/img/052026/tien-nghich.webp?t=1779886626"
COVER_FILE = "cover_tien_nghich.jpg"
EPUB_OUTPUT = "Tien_Nghich_Full_2120.epub"

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://webnovel.vn/tien-nghich/"
}


def download_cover():
    if os.path.exists(COVER_FILE):
        return COVER_FILE
    try:
        req = urllib.request.Request(COVER_URL, headers=HEADERS)
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=15) as res:
            with open(COVER_FILE, "wb") as f:
                f.write(res.read())
        print(f"[+] Đã tải ảnh bìa: {COVER_FILE}")
        return COVER_FILE
    except Exception as e:
        print(f"[!] Không tải được ảnh bìa: {e}")
        return None


def fetch_chapter(ch_idx, max_retries=3):
    fpath = os.path.join(OUTPUT_DIR, f"{ch_idx:04d}.txt")
    if os.path.exists(fpath) and os.path.getsize(fpath) > 100:
        return ch_idx, True

    url = BASE_URL.format(ch_idx)
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, context=SSL_CTX, timeout=12) as res:
                content = res.read().decode("utf-8", errors="ignore")

            m_title = re.search(r'<p class=["\']reader__chapter["\']>(.*?)</p>', content, re.I | re.S)
            title = m_title.group(1).strip() if m_title else f"Chương {ch_idx}"
            title = html.unescape(title)

            m_body = re.search(r'<div id=["\']chapter-c["\'][^>]*>(.*?)</div>', content, re.I | re.S)
            if not m_body:
                m_body = re.search(r'<article class=["\']reader__content["\'][^>]*>(.*?)</article>', content, re.I | re.S)

            if not m_body:
                raise ValueError("Không tìm thấy thẻ nội dung chương")

            raw_body = m_body.group(1)
            # Chuẩn hoá văn bản: đổi <br> thành xuống dòng, bỏ thẻ HTML lạ
            text = re.sub(r'<br\s*/?>', '\n', raw_body, flags=re.I)
            text = re.sub(r'</?(?:p|div)[^>]*>', '\n', text, flags=re.I)
            text = re.sub(r'<[^>]+>', '', text)
            text = html.unescape(text)

            # Lọc khoảng trắng thừa
            lines = [l.strip() for l in text.split('\n') if l.strip()]
            clean_body = '\n\n'.join(lines)

            if len(clean_body) < 50:
                raise ValueError("Nội dung quá ngắn")

            with open(fpath, "w", encoding="utf-8") as f:
                f.write(f"{title}\n\n{clean_body}")

            return ch_idx, True
        except Exception:
            time.sleep(0.5 + attempt * 0.5)

    return ch_idx, False


def run_crawler(start=1, end=TOTAL_CHAPTERS, workers=12):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    cover_path = download_cover()

    print(f"[*] Bắt đầu tải Tiên Nghịch ({start} -> {end}) với {workers} luồng song song...")
    success_count = 0
    fail_count = 0

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(fetch_chapter, idx): idx for idx in range(start, end + 1)}
        for future in as_completed(futures):
            idx = futures[future]
            try:
                ch_idx, ok = future.result()
                if ok:
                    success_count += 1
                else:
                    fail_count += 1
                    print(f"[!] Thất bại Chương {idx}")
            except Exception as e:
                fail_count += 1
                print(f"[!] Lỗi Chương {idx}: {e}")

            done = success_count + fail_count
            if done % 100 == 0 or done == (end - start + 1):
                pct = (done / (end - start + 1)) * 100
                print(f"[*] Tiến độ: {done}/{end - start + 1} ({pct:.1f}%) - Thành công: {success_count}, Thất bại: {fail_count}")

    print(f"\n[+] Tải xong! Thành công: {success_count}/{end - start + 1}")

    # Đóng gói EPUB
    print("\n[*] Đang đọc dữ liệu các chương để đóng gói EPUB...")
    chapters_data = []
    for idx in range(start, end + 1):
        fpath = os.path.join(OUTPUT_DIR, f"{idx:04d}.txt")
        if os.path.exists(fpath):
            with open(fpath, "r", encoding="utf-8") as f:
                content = f.read().strip()
            parts = content.split("\n\n", 1)
            title = parts[0].strip() if parts else f"Chương {idx}"
            body = parts[1].strip() if len(parts) > 1 else ""
            chapters_data.append((title, body))

    if chapters_data:
        print(f"[*] Đang đóng gói {len(chapters_data)} chương vào {EPUB_OUTPUT}...")
        build_epub_from_chapters(
            title="Tiên Nghịch (Bản Dịch Chuẩn)",
            author="Nhĩ Căn",
            chapters=chapters_data,
            output_path=EPUB_OUTPUT,
            cover_image=cover_path
        )
        print(f"\n🎉 HOÀN THÀNH! File EPUB đã sẵn sàng: {EPUB_OUTPUT}")
        print("Bạn có thể kéo thả file này trực tiếp vào web Cửu U Thư Các để đọc.")


if __name__ == "__main__":
    run_crawler()
