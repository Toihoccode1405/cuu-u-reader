#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
Tiên Nghịch - Bản Dịch Chuẩn Kinh Điển Full (1974 Chương)
Nguồn: Bản dịch chuẩn kinh điển (Ly hương -> Bỗng nhiên quay đầu)
Đa luồng tải nhanh + Tự động đóng gói thành Tien_Nghich_Ban_Dich_Chuan_Full.epub
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

TOTAL_CHAPTERS = 1974
BASE_URL = "https://wetruyen.com/tien-nghich/chuong-{}.html"
OUTPUT_DIR = "chapters_tien_nghich_dich"
COVER_URL = "https://cdn.wetruyen.com/medias/covers/0/2-tien-nghich_cover_large.jpg"
COVER_FILE = "cover_tien_nghich.jpg"
EPUB_OUTPUT = "Tien_Nghich_Ban_Dich_Chuan_Full.epub"

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://wetruyen.com/tien-nghich.2"
}


def download_cover():
    if os.path.exists(COVER_FILE) and os.path.getsize(COVER_FILE) > 1000:
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


def fetch_chapter(ch_idx, max_retries=4):
    fpath = os.path.join(OUTPUT_DIR, f"{ch_idx:04d}.txt")
    if os.path.exists(fpath) and os.path.getsize(fpath) > 200:
        return ch_idx, True

    url = BASE_URL.format(ch_idx)
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, context=SSL_CTX, timeout=12) as res:
                content = res.read().decode("utf-8", errors="ignore")

            m_title = re.search(r'title=["\'](?:Tiên Nghịch\s*-\s*)?(Chương\s*\d+[^"\']*)["\']', content, re.I)
            if not m_title:
                m_title = re.search(r'<title>(.*?)<\/title>', content, re.I)
                title = m_title.group(1).replace("của truyện Tiên Nghịch", "").strip() if m_title else f"Chương {ch_idx}"
            else:
                title = m_title.group(1).strip()
            title = html.unescape(title)

            m_body = re.search(r'<div[^>]*id=["\']chapter-c["\'][^>]*>(.*?)</div>', content, re.I | re.S)
            if not m_body:
                raise ValueError("Không tìm thấy nội dung chương")

            raw_body = m_body.group(1)
            # Dọn dẹp nội dung quảng cáo
            raw_body = re.sub(r'<script[\s\S]*?<\/script>', '', raw_body, flags=re.I)
            raw_body = re.sub(r'<!--[\s\S]*?-->', '', raw_body)
            raw_body = re.sub(r'Bạn đang đọc truyện tại.*?(?:\n|<br\s*\/?>)', '', raw_body, flags=re.I)

            # Chuẩn hóa văn bản
            text = re.sub(r'<br\s*\/?>', '\n', raw_body, flags=re.I)
            text = re.sub(r'</?(?:p|div)[^>]*>', '\n', text, flags=re.I)
            text = re.sub(r'<[^>]+>', '', text)
            text = html.unescape(text)

            lines = [l.strip() for l in text.split('\n') if l.strip()]
            clean_body = '\n\n'.join(lines)

            if len(clean_body) < 100:
                raise ValueError("Nội dung chương quá ngắn")

            with open(fpath, "w", encoding="utf-8") as f:
                f.write(f"{title}\n\n{clean_body}")

            return ch_idx, True
        except Exception:
            time.sleep(0.4 + attempt * 0.4)

    return ch_idx, False


def run_crawler(start=1, end=TOTAL_CHAPTERS, workers=16):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    cover_path = download_cover()

    print(f"[*] Bắt đầu tải Tiên Nghịch - Bản Dịch Chuẩn ({start} -> {end}) với {workers} luồng song song...")
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
            except Exception:
                fail_count += 1

            done = success_count + fail_count
            if done % 100 == 0 or done == (end - start + 1):
                pct = (done / (end - start + 1)) * 100
                print(f"[*] Tiến độ: {done}/{end - start + 1} ({pct:.1f}%) - Thành công: {success_count}, Thất bại: {fail_count}")

    print(f"\n[+] Hoàn tất tải! Thành công: {success_count}/{end - start + 1}")

    # Đóng gói EPUB
    print("\n[*] Đang tổng hợp toàn bộ các chương vào file EPUB...")
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
            title="Tiên Nghịch (Bản Dịch Chuẩn Full)",
            author="Nhĩ Căn",
            chapters=chapters_data,
            output_path=EPUB_OUTPUT,
            cover_image=cover_path
        )
        print(f"\n🎉 THÀNH CÔNG! File EPUB đã tạo xong: {EPUB_OUTPUT}")
        print("Bạn có thể kéo thả file này vào trình đọc Cửu U Thư Các để thưởng thức.")


if __name__ == "__main__":
    run_crawler()
