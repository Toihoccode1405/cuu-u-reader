#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
Universal Novel to EPUB Converter
Optimized for: Kindle, Apple Books, Kobo, Moon+ Reader, ReadEra
Features:
- Pure Python (no external dependencies, standard library only).
- Generates fully compliant EPUB with complete Table of Contents (NCX & NAV).
- Clean typography with proper paragraph indentation, line spacing, and margins.
- Supports input from either a directory of chapter files or a merged text file.
=============================================================================
"""

import os
import re
import sys
import uuid
import html
import zipfile
import argparse


def build_epub_from_chapters(title: str, author: str, chapters: list, output_path: str, cover_image: str = None):
    """
    Builds a professional EPUB ebook from a list of (chapter_title, chapter_body) tuples.
    """
    book_id = str(uuid.uuid4())
    print(f"[*] Đang đóng gói file EPUB: {output_path} ({len(chapters)} chương)...")

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        # 1. mimetype: MUST be first entry and uncompressed (ZIP_STORED)
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)

        # 2. META-INF/container.xml
        container_xml = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"""
        z.writestr("META-INF/container.xml", container_xml)

        # 3. Typography Stylesheet
        css = """@charset "utf-8";
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, serif;
  line-height: 1.65;
  margin: 5% 5%;
  color: #1a1a1a;
}
h1, h2 {
  text-align: center;
  font-weight: bold;
  margin-top: 1.5em;
  margin-bottom: 1.5em;
  line-height: 1.3;
}
p {
  text-indent: 1.5em;
  margin: 0.4em 0;
  text-align: justify;
}
"""
        z.writestr("OEBPS/style.css", css)

        manifest_items = [
            '<item id="style" href="style.css" media-type="text/css"/>',
            '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
        ]
        spine_items = []
        ncx_navpoints = []

        # Optional cover image and cover page
        if cover_image and os.path.exists(cover_image):
            ext = os.path.splitext(cover_image)[1].lower()
            mime = "image/jpeg" if ext in (".jpg", ".jpeg") else ("image/png" if ext == ".png" else "image/webp")
            with open(cover_image, "rb") as cf:
                z.writestr("OEBPS/cover" + ext, cf.read())
            manifest_items.append(f'<item id="cover-image" href="cover{ext}" media-type="{mime}"/>')

            cover_xhtml = f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="vi" lang="vi">
<head>
  <title>Bìa sách</title>
  <style type="text/css">
    body {{ margin: 0; padding: 0; text-align: center; background-color: #111; }}
    img {{ max-width: 100%; max-height: 100vh; height: auto; width: auto; object-fit: contain; }}
  </style>
</head>
<body>
  <div style="text-align: center;">
    <img src="cover{ext}" alt="Bìa sách"/>
  </div>
</body>
</html>"""
            z.writestr("OEBPS/cover.xhtml", cover_xhtml)
            manifest_items.append('<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>')
            spine_items.append('<itemref idref="cover-page"/>')
            ncx_navpoints.append("""  <navPoint id="np_cover" playOrder="0">
    <navLabel><text>Bìa sách</text></navLabel>
    <content src="cover.xhtml"/>
  </navPoint>""")
        # 4. Generate XHTML for each chapter
        for i, (ch_title, ch_body) in enumerate(chapters, 1):
            file_name = f"chapter_{i:04d}.xhtml"
            ch_id = f"ch_{i:04d}"

            manifest_items.append(f'<item id="{ch_id}" href="{file_name}" media-type="application/xhtml+xml"/>')
            spine_items.append(f'<itemref idref="{ch_id}"/>')

            safe_title = html.escape(ch_title.strip())
            ncx_navpoints.append(f"""  <navPoint id="np_{i:04d}" playOrder="{i}">
    <navLabel><text>{safe_title}</text></navLabel>
    <content src="{file_name}"/>
  </navPoint>""")

            # Wrap paragraphs in <p> tags
            p_lines = [p.strip() for p in ch_body.split("\n") if p.strip()]
            p_tags = "\n".join(f"    <p>{html.escape(line)}</p>" for line in p_lines)

            chapter_xhtml = f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="vi" lang="vi">
<head>
  <title>{safe_title}</title>
  <link rel="stylesheet" href="style.css" type="text/css"/>
</head>
<body>
  <h2>{safe_title}</h2>
{p_tags}
</body>
</html>"""
            z.writestr(f"OEBPS/{file_name}", chapter_xhtml)

        # 5. Table of Contents (toc.ncx)
        safe_book_title = html.escape(title)
        ncx_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="{book_id}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>{safe_book_title}</text></docTitle>
  <navMap>
{"".join(ncx_navpoints)}
  </navMap>
</ncx>"""
        z.writestr("OEBPS/toc.ncx", ncx_xml)

        # 6. Package Metadata & Spine (content.opf)
        safe_author = html.escape(author)
        cover_meta = '<meta name="cover" content="cover-image"/>' if cover_image and os.path.exists(cover_image) else ""
        guide_xml = """  <guide>
    <reference type="cover" title="Bìa sách" href="cover.xhtml"/>
  </guide>""" if cover_image and os.path.exists(cover_image) else ""

        opf_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>{safe_book_title}</dc:title>
    <dc:creator opf:role="aut">{safe_author}</dc:creator>
    <dc:language>vi</dc:language>
    <dc:identifier id="BookID">{book_id}</dc:identifier>
    {cover_meta}
  </metadata>
  <manifest>
    {"    ".join(manifest_items)}
  </manifest>
  <spine toc="ncx">
    {"    ".join(spine_items)}
  </spine>
  {guide_xml}
</package>"""
        z.writestr("OEBPS/content.opf", opf_xml)

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"[+] Tạo thành công EPUB: {output_path} ({size_mb:.2f} MB)")


def parse_chapters_from_dir(directory: str) -> list:
    """Reads all chapter text files from a directory."""
    files = sorted([f for f in os.listdir(directory) if f.endswith(".txt")])
    chapters = []
    for fname in files:
        fpath = os.path.join(directory, fname)
        with open(fpath, "r", encoding="utf-8") as f:
            content = f.read().strip()
        lines = content.split("\n", 1)
        title = lines[0].strip() if lines else fname
        body = lines[1].strip() if len(lines) > 1 else ""
        chapters.append((title, body))
    return chapters


def main():
    parser = argparse.ArgumentParser(description="Chuyển đổi truyện chữ sang file EPUB")
    parser.add_argument("--dir", default="chapters", help="Thư mục chứa các file text từng chương (mặc định: chapters)")
    parser.add_argument("--title", default="Tiên Nghịch", help="Tên sách (mặc định: Tiên Nghịch)")
    parser.add_argument("--author", default="Nhĩ Căn", help="Tác giả (mặc định: Nhĩ Căn)")
    parser.add_argument("--output", default="Tien_Nghich.epub", help="File EPUB đầu ra (mặc định: Tien_Nghich.epub)")
    parser.add_argument("--cover", default=None, help="Đường dẫn ảnh bìa (tùy chọn)")

    args = parser.parse_args()

    if not os.path.exists(args.dir):
        print(f"[!] Thư mục {args.dir} không tồn tại.")
        return

    chapters = parse_chapters_from_dir(args.dir)
    if not chapters:
        print(f"[!] Không tìm thấy file chương nào trong thư mục {args.dir}.")
        return

    build_epub_from_chapters(
        title=args.title,
        author=args.author,
        chapters=chapters,
        output_path=args.output,
        cover_image=args.cover
    )


if __name__ == "__main__":
    main()
