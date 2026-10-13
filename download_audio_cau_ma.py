#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
Cầu Ma - Lát Radio (MC Lát) Complete Audio Downloader
Full series: Tập 1 đến Tập 264 (END)
Source: radiotruyen.online (Decrypted direct CDN stream)
=============================================================================
"""

import os
import sys
import json
import time
import argparse
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed


PLAYLIST_FILE = "cau_ma_lat_radio_playlist.json"
DEFAULT_OUTPUT_DIR = "audio_cau_ma"


def load_playlist(path: str = PLAYLIST_FILE) -> list:
    if not os.path.exists(path):
        raise FileNotFoundError(f"Không tìm thấy file danh sách phát: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def create_session(workers: int) -> requests.Session:
    session = requests.Session()
    adapter = requests.adapters.HTTPAdapter(
        pool_connections=workers * 2,
        pool_maxsize=workers * 2,
        max_retries=3
    )
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://radiotruyen.online/truyen-huyen-huyen/cau-ma-tien-hiep-huyen-huyen.html"
    })
    return session


def download_single_track(session: requests.Session, track_info: dict, output_dir: str, idx: int, total: int, delay: float = 0.05) -> tuple[int, bool, str]:
    """Downloads a single MP3 episode with resume support."""
    title = track_info.get("title", f"Tap_{idx:03d}")
    url = track_info.get("source") or track_info.get("mp3")
    if not url:
        return idx, False, "Không có URL audio"

    clean_title = "".join(c for c in title if c.isalnum() or c in (" ", "-", "_", "(", ")")).strip()
    file_name = f"{idx:03d}_{clean_title}.mp3"
    file_path = os.path.join(output_dir, file_name)

    if os.path.exists(file_path) and os.path.getsize(file_path) > 1024 * 1024:
        size_mb = os.path.getsize(file_path) / (1024 * 1024)
        return idx, True, f"Bỏ qua (Đã có, {size_mb:.1f} MB)"

    for attempt in range(3):
        try:
            if delay > 0:
                time.sleep(delay)

            resp = session.get(url, stream=True, timeout=30)
            if resp.status_code == 200:
                temp_path = file_path + ".tmp"
                total_bytes = 0
                with open(temp_path, "wb") as f:
                    for chunk in resp.iter_content(chunk_size=262144):
                        if chunk:
                            f.write(chunk)
                            total_bytes += len(chunk)

                if os.path.exists(file_path):
                    os.remove(file_path)
                os.rename(temp_path, file_path)

                size_mb = total_bytes / (1024 * 1024)
                return idx, True, f"Tải thành công ({size_mb:.1f} MB)"
            else:
                time.sleep(1)
        except Exception as e:
            time.sleep(1)

    return idx, False, "Thất bại sau 3 lần thử"


def download_tracks(start_idx: int = 1, end_idx: int = None, workers: int = 10, output_dir: str = DEFAULT_OUTPUT_DIR, delay: float = 0.02):
    playlist = load_playlist()
    total_in_list = len(playlist)

    if end_idx is None:
        end_idx = total_in_list

    start_idx = max(1, start_idx)
    end_idx = min(total_in_list, end_idx)

    selected = [
        (i, playlist[i - 1]) for i in range(start_idx, end_idx + 1)
    ]

    os.makedirs(output_dir, exist_ok=True)
    total_selected = len(selected)
    session = create_session(workers)

    print(f"[*] Bắt đầu tải Cầu Ma - Lát Radio:")
    print(f"    - Phạm vi: Tập {start_idx} đến Tập {end_idx} (Tổng số: {total_selected} tập)")
    print(f"    - Thư mục lưu: {os.path.abspath(output_dir)}")
    print(f"    - Số luồng tải đồng thời: {workers}")
    print("=" * 70)

    success_cnt = 0
    fail_cnt = 0

    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_map = {
            executor.submit(download_single_track, session, track, output_dir, idx, total_selected, delay): (idx, track)
            for idx, track in selected
        }

        for count, fut in enumerate(as_completed(future_map), 1):
            idx, track = future_map[fut]
            try:
                track_idx, ok, msg = fut.result()
                if ok:
                    success_cnt += 1
                else:
                    fail_cnt += 1
                print(f"[{count:03d}/{total_selected:03d}] Tập {track_idx:03d}: {msg} - {track.get('title')}")
            except Exception as e:
                fail_cnt += 1
                print(f"[{count:03d}/{total_selected:03d}] Tập {idx:03d}: Lỗi {e}")

    print("=" * 70)
    print(f"[+] Hoàn tất: {success_cnt}/{total_selected} tập thành công, {fail_cnt} lỗi.")


def main():
    parser = argparse.ArgumentParser(description="Cầu Ma - Lát Radio Audio Downloader (Tập 1 - 264 END)")
    parser.add_argument("--start", type=int, default=1, help="Tập bắt đầu tải (1 - 264, mặc định: 1)")
    parser.add_argument("--end", type=int, default=None, help="Tập kết thúc tải (mặc định: tải đến hết)")
    parser.add_argument("--workers", type=int, default=10, help="Số luồng tải đồng thời (mặc định: 10)")
    parser.add_argument("--delay", type=float, default=0.02, help="Độ trễ giữa các request (giây)")
    parser.add_argument("--output", default=DEFAULT_OUTPUT_DIR, help=f"Thư mục lưu trữ (mặc định: {DEFAULT_OUTPUT_DIR})")
    parser.add_argument("--list", action="store_true", help="Xem danh sách 264 tập mà không tải")

    args = parser.parse_args()

    if args.list:
        playlist = load_playlist()
        print(f"Tổng số tập: {len(playlist)}")
        for i, item in enumerate(playlist, 1):
            print(f"  [{i:03d}] {item.get('title')} -> {item.get('source')}")
        return

    download_tracks(
        start_idx=args.start,
        end_idx=args.end,
        workers=args.workers,
        output_dir=args.output,
        delay=args.delay
    )


if __name__ == "__main__":
    main()
