#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
Đại Quản Gia Là Ma Hoàng - AI Translation & Polish Pipeline
Sử dụng DeepSeek API hoặc Google Gemini API để dịch / nhuận sắc sang bản dịch chuẩn mượt mà.
Hỗ trợ:
- DeepSeek (deepseek-chat)
- Gemini (gemini-2.0-flash / gemini-1.5-flash)
- Resume tiến độ (chương nào đã dịch sẽ bỏ qua)
- Đóng gói tự động thành Dai_Quan_Gia_La_Ma_Hoang_Ban_Dich_Chuan.epub
=============================================================================
"""

import os
import re
import sys
import time
import json
import ssl
import html
import zipfile
import argparse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from create_epub import build_epub_from_chapters

EPUB_SOURCE = "Đại Quản Gia Là Ma Hoàng.epub"
OUTPUT_DIR = "chapters_ma_hoang_dich"
COVER_FILE = "cover_ma_hoang.jpg"
EPUB_OUTPUT = "Dai_Quan_Gia_La_Ma_Hoang_Ban_Dich_Chuan.epub"

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

SYSTEM_PROMPT = """Bạn là dịch giả tiểu thuyết tiên hiệp / huyền huyễn kỳ cựu hàng đầu Việt Nam.
Nhiệm vụ của bạn là dịch và nhuận sắc lại nội dung chương của tiểu thuyết "Đại Quản Gia Là Ma Hoàng" (nhân vật chính: Trác Nhất Phàm / Trác Phàm).

YÊU CẦU DỊCH THUẬT:
1. Văn phong: Giàu chất kiếm hiệp cổ phong, hào hùng, ma đạo lạnh khốc, nhịp văn dứt khoát, đối thoại tự nhiên, câu từ thuần Việt mượt mà và đọc cực kỳ cuốn hút.
2. Tuyệt đối loại bỏ: Lỗi ngữ pháp đảo lộn Hán-Việt, từ lóng mạng, icon emo, từ ngữ dịch máy thô (như "Chỉ bất quá", "nhật nguyệt song song", "khí thể màu đen", "vỗ nhè nhẹ đập cái đầu nhỏ").
3. Giữ chuẩn tên riêng: Trác Nhất Phàm, Trác Phàm, Lạc Vân Thường, Lạc Vân Hải, Bàng thống lĩnh, Cổ Tam Thông, Sở Khuynh Thành, Cửu U Bí Lục, Thiên Ma Đại Hóa Quyết, Thiên Ma Phong, Lạc gia...
4. Định dạng đầu ra:
Dòng 1: Tiêu đề chương (ví dụ: Chương 1: Cửu U Bí Lục)
Tiếp theo: Toàn bộ nội dung chương đã dịch hoàn chỉnh, các đoạn văn cách nhau bằng một dòng trống.
Không thêm bất kỳ lời chào, giải thích, hay ký hiệu markdown code block thừa thãi nào."""


def extract_chapters_from_epub(epub_path):
    if not os.path.exists(epub_path):
        raise FileNotFoundError(f"Không tìm thấy file nguồn: {epub_path}")

    with zipfile.ZipFile(epub_path, "r") as z:
        opf_name = [f for f in z.namelist() if f.endswith(".opf")][0]
        opf_data = z.read(opf_name).decode("utf-8", errors="ignore")
        opf_dir = os.path.dirname(opf_name)

        manifest = {}
        for it in re.finditer(r'<item\s+[^>]*id=["\']([^"\']+)["\'][^>]*href=["\']([^"\']+)["\']', opf_data):
            manifest[it.group(1)] = it.group(2)

        spine_m = re.search(r'<spine[^>]*>([\s\S]*?)</spine>', opf_data)
        if not spine_m:
            raise ValueError("Không tìm thấy thẻ spine trong EPUB")

        idrefs = re.findall(r'<itemref\s+[^>]*idref=["\']([^"\']+)["\']', spine_m.group(1))

        chapters = []
        for idref in idrefs:
            if idref in ("cover-page", "cover", "titlepage"):
                continue
            href = manifest.get(idref)
            if not href:
                continue
            full_path = f"{opf_dir}/{href}" if opf_dir else href
            full_path = full_path.replace("\\", "/")
            if full_path in z.namelist():
                content = z.read(full_path).decode("utf-8", errors="ignore")
                # Lấy text sạch
                h1_m = re.search(r'<h[12][^>]*>(.*?)</h[12]>', content, re.I | re.S)
                title = re.sub(r'<[^>]+>', '', h1_m.group(1)).strip() if h1_m else idref
                title = re.sub(r'^\ufeff', '', title)

                # Lấy các thẻ <p>
                ps = re.findall(r'<p[^>]*>(.*?)</p>', content, re.I | re.S)
                body_lines = []
                for p in ps:
                    p_text = re.sub(r'<[^>]+>', '', p).strip()
                    if p_text:
                        body_lines.append(p_text)

                body = "\n\n".join(body_lines)
                if len(body) > 100:
                    chapters.append((idref, title, body))

    return chapters


def call_deepseek(prompt, api_key, model="deepseek-chat"):
    url = "https://api.deepseek.com/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.7,
        "max_tokens": 4096
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }
    )
    with urllib.request.urlopen(req, context=SSL_CTX, timeout=60) as res:
        data = json.loads(res.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"].strip()


def call_gemini(prompt, api_key, model="gemini-2.0-flash"):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": f"{SYSTEM_PROMPT}\n\n---\nNỘI DUNG CẦN DỊCH:\n{prompt}"}]
            }
        ],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 4096
        }
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, context=SSL_CTX, timeout=60) as res:
        data = json.loads(res.read().decode("utf-8"))
        candidates = data.get("candidates", [])
        if candidates and "content" in candidates[0]:
            return candidates[0]["content"]["parts"][0]["text"].strip()
        raise ValueError(f"Gemini API không trả về nội dung: {data}")


def translate_single_chapter(idref, title, body, provider, api_key, model, max_retries=3):
    fpath = os.path.join(OUTPUT_DIR, f"{idref}.txt")
    if os.path.exists(fpath) and os.path.getsize(fpath) > 200:
        return idref, True

    input_text = f"Tiêu đề: {title}\n\nNội dung:\n{body}"
    for attempt in range(max_retries):
        try:
            if provider == "gemini":
                translated = call_gemini(input_text, api_key, model=model or "gemini-2.0-flash")
            else:
                translated = call_deepseek(input_text, api_key, model=model or "deepseek-chat")

            if len(translated) < 100:
                raise ValueError("Bản dịch quá ngắn")

            with open(fpath, "w", encoding="utf-8") as f:
                f.write(translated)

            return idref, True
        except Exception as e:
            time.sleep(2 + attempt * 2)

    return idref, False


def build_final_epub(chapters_meta):
    print(f"\n[*] Đang tổng hợp các chương đã dịch vào file EPUB: {EPUB_OUTPUT}...")
    chapters_data = []
    for idref, orig_title, _ in chapters_meta:
        fpath = os.path.join(OUTPUT_DIR, f"{idref}.txt")
        if os.path.exists(fpath):
            with open(fpath, "r", encoding="utf-8") as f:
                content = f.read().strip()
            parts = content.split("\n\n", 1)
            title = parts[0].strip() if parts else orig_title
            # Bỏ markdown header nếu AI tự gắn
            title = re.sub(r'^#+\s*', '', title)
            body = parts[1].strip() if len(parts) > 1 else ""
            chapters_data.append((title, body))

    if chapters_data:
        cover_path = COVER_FILE if os.path.exists(COVER_FILE) else None
        build_epub_from_chapters(
            title="Đại Quản Gia Là Ma Hoàng (Bản Dịch Chuẩn)",
            author="Dạ Kiêu",
            chapters=chapters_data,
            output_path=EPUB_OUTPUT,
            cover_image=cover_path
        )
        print(f"[+] Tạo thành công: {EPUB_OUTPUT} ({len(chapters_data)} chương)!")


def main():
    parser = argparse.ArgumentParser(description="AI Translation Pipeline cho Đại Quản Gia Là Ma Hoàng")
    parser.add_argument("--provider", choices=["deepseek", "gemini"], default="deepseek", help="Nhà cung cấp AI (deepseek hoặc gemini)")
    parser.add_argument("--key", default=None, help="API Key (hoặc set biến môi trường DEEPSEEK_API_KEY / GEMINI_API_KEY)")
    parser.add_argument("--model", default=None, help="Tên model cụ thể (VD: deepseek-chat, gemini-2.0-flash)")
    parser.add_argument("--start", type=int, default=1, help="Chương bắt đầu dịch (mặc định: 1)")
    parser.add_argument("--end", type=int, default=None, help="Chương kết thúc (mặc định: hết)")
    parser.add_argument("--workers", type=int, default=3, help="Số luồng dịch đồng thời (mặc định: 3)")
    parser.add_argument("--pack-only", action="store_true", help="Chỉ đóng gói các chương đã dịch thành EPUB mà không dịch thêm")

    args = parser.parse_args()

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("[*] Đang đọc cấu trúc chương từ EPUB gốc...")
    raw_chapters = extract_chapters_from_epub(EPUB_SOURCE)
    print(f"[+] Đã tìm thấy {len(raw_chapters)} chương hợp lệ trong EPUB.")

    if args.pack_only:
        build_final_epub(raw_chapters)
        return

    api_key = args.key
    if not api_key:
        if args.provider == "gemini":
            api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        else:
            api_key = os.environ.get("DEEPSEEK_API_KEY")

    if not api_key:
        print(f"\n[!] Chưa có API Key cho {args.provider}.")
        print(f"    Bạn có thể truyền trực tiếp: python ai_translate_ma_hoang.py --provider {args.provider} --key <API_KEY>")
        print(f"    Hoặc nhập API Key ngay tại đây:")
        try:
            api_key = input("API Key: ").strip()
        except EOFError:
            pass

    if not api_key:
        print("[!] Không có API Key. Dừng chương trình.")
        sys.exit(1)

    start_idx = max(1, args.start) - 1
    end_idx = min(len(raw_chapters), args.end) if args.end else len(raw_chapters)
    selected_chapters = raw_chapters[start_idx:end_idx]

    total_tasks = len(selected_chapters)
    print(f"\n[*] Bắt đầu dịch {total_tasks} chương ({args.start} -> {end_idx}) bằng {args.provider.upper()} ({args.workers} luồng)...")

    success_count = 0
    fail_count = 0

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(
                translate_single_chapter, idref, title, body, args.provider, api_key, args.model
            ): (idref, title)
            for idref, title, body in selected_chapters
        }

        for future in as_completed(futures):
            idref, title = futures[future]
            try:
                ch_id, ok = future.result()
                if ok:
                    success_count += 1
                else:
                    fail_count += 1
                    print(f"[!] Thất bại: {title}")
            except Exception as e:
                fail_count += 1
                print(f"[!] Lỗi: {title} ({e})")

            done = success_count + fail_count
            if done % 10 == 0 or done == total_tasks:
                print(f"[*] Tiến độ dịch: {done}/{total_tasks} ({(done / total_tasks) * 100:.1f}%)")

    print(f"\n[+] Hoàn tất đợt dịch! Thành công: {success_count}/{total_tasks}")
    build_final_epub(raw_chapters)


if __name__ == "__main__":
    main()
