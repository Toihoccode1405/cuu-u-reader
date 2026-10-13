use quick_xml::events::Event;
use quick_xml::reader::Reader;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterInfo {
    pub index: usize,
    pub title: String,
    pub href: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedEpubMetadata {
    pub title: String,
    pub author: String,
    pub chapters: Vec<ChapterInfo>,
    pub cover_image: Option<String>,
}

pub struct EpubParser;

impl EpubParser {
    pub fn parse_file(path: &Path) -> Result<ParsedEpubMetadata, String> {
        let file = File::open(path).map_err(|e| format!("Cannot open file: {}", e))?;
        let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid zip/epub: {}", e))?;

        // 1. Read META-INF/container.xml to find content.opf path
        let opf_path = Self::find_opf_path(&mut archive)?;
        let opf_dir = Path::new(&opf_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        // 2. Read content.opf
        let opf_content = Self::read_zip_entry(&mut archive, &opf_path)?;
        let (title, author, manifest, spine, cover_id) = Self::parse_opf(&opf_content)?;

        // 3. Try reading TOC (toc.ncx or nav)
        let chapters = Self::parse_toc(&mut archive, &manifest, &spine, &opf_dir)?;

        let cover_image = cover_id
            .and_then(|id| manifest.get(&id))
            .map(|href| Self::resolve_path(&opf_dir, href));

        Ok(ParsedEpubMetadata {
            title,
            author,
            chapters,
            cover_image,
        })
    }

    pub fn extract_cover(path: &Path, cover_href: &str) -> Result<Vec<u8>, String> {
        let file = File::open(path).map_err(|e| e.to_string())?;
        let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
        Self::read_zip_entry_bytes(&mut archive, cover_href)
    }

    pub fn read_chapter_content(path: &Path, href: &str) -> Result<String, String> {
        let file = File::open(path).map_err(|e| e.to_string())?;
        let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
        Self::read_zip_entry(&mut archive, href)
    }

    fn find_opf_path(archive: &mut ZipArchive<File>) -> Result<String, String> {
        let container_xml = Self::read_zip_entry(archive, "META-INF/container.xml")?;
        let mut reader = Reader::from_str(&container_xml);
        reader.config_mut().trim_text(true);

        let mut buf = Vec::new();
        loop {
            match &reader.read_event_into(&mut buf) {
                Ok(Event::Empty(e)) | Ok(Event::Start(e)) => {
                    if e.name().as_ref() == b"rootfile" {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"full-path" {
                                return String::from_utf8(attr.value.to_vec())
                                    .map_err(|e| e.to_string());
                            }
                        }
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(format!("XML error: {}", e)),
                _ => {}
            }
            buf.clear();
        }
        Err("Could not find rootfile in container.xml".to_string())
    }

    fn parse_opf(
        opf_xml: &str,
    ) -> Result<
        (
            String,
            String,
            HashMap<String, String>,
            Vec<String>,
            Option<String>,
        ),
        String,
    > {
        let mut reader = Reader::from_str(opf_xml);
        reader.config_mut().trim_text(true);

        let mut title = "Unknown Title".to_string();
        let mut author = "Unknown Author".to_string();
        let mut manifest: HashMap<String, String> = HashMap::new();
        let mut spine: Vec<String> = Vec::new();
        let mut cover_id: Option<String> = None;

        let mut in_title = false;
        let mut in_creator = false;
        let mut buf = Vec::new();

        loop {
            match &reader.read_event_into(&mut buf) {
                Ok(Event::Start(e)) => {
                    let local_name = e.local_name();
                    if local_name.as_ref() == b"title" {
                        in_title = true;
                    } else if local_name.as_ref() == b"creator" {
                        in_creator = true;
                    }
                }
                Ok(Event::Text(e)) => {
                    if in_title {
                        title = e.unescape().unwrap_or_default().to_string();
                    } else if in_creator {
                        author = e.unescape().unwrap_or_default().to_string();
                    }
                }
                Ok(Event::End(e)) => {
                    let local_name = e.local_name();
                    if local_name.as_ref() == b"title" {
                        in_title = false;
                    } else if local_name.as_ref() == b"creator" {
                        in_creator = false;
                    }
                }
                Ok(Event::Empty(e)) => {
                    let local_name = e.local_name();
                    if local_name.as_ref() == b"item" {
                        let mut id = String::new();
                        let mut href = String::new();
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"id" {
                                id = String::from_utf8_lossy(&attr.value).to_string();
                            } else if attr.key.as_ref() == b"href" {
                                href = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }
                        if !id.is_empty() && !href.is_empty() {
                            manifest.insert(id, href);
                        }
                    } else if local_name.as_ref() == b"itemref" {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"idref" {
                                spine.push(String::from_utf8_lossy(&attr.value).to_string());
                            }
                        }
                    } else if local_name.as_ref() == b"meta" {
                        let mut is_cover = false;
                        let mut content = String::new();
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"name" && attr.value.as_ref() == b"cover" {
                                is_cover = true;
                            } else if attr.key.as_ref() == b"content" {
                                content = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }
                        if is_cover && !content.is_empty() {
                            cover_id = Some(content);
                        }
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(format!("OPF parse error: {}", e)),
                _ => {}
            }
        }

        Ok((title, author, manifest, spine, cover_id))
    }

    fn parse_toc(
        archive: &mut ZipArchive<File>,
        manifest: &HashMap<String, String>,
        spine: &[String],
        opf_dir: &str,
    ) -> Result<Vec<ChapterInfo>, String> {
        // Find ncx item in manifest
        let ncx_href = manifest
            .iter()
            .find(|(id, href)| id.contains("ncx") || href.ends_with(".ncx"))
            .map(|(_, href)| href.as_str());

        if let Some(ncx_file) = ncx_href {
            let ncx_full_path = Self::resolve_path(opf_dir, ncx_file);
            if let Ok(ncx_xml) = Self::read_zip_entry(archive, &ncx_full_path) {
                if let Ok(chapters) = Self::parse_ncx(&ncx_xml, opf_dir) {
                    if !chapters.is_empty() {
                        return Ok(chapters);
                    }
                }
            }
        }

        // Fallback: build from spine
        let mut chapters = Vec::new();
        for (i, idref) in spine.iter().enumerate() {
            if let Some(href) = manifest.get(idref) {
                let full_href = Self::resolve_path(opf_dir, href);
                chapters.push(ChapterInfo {
                    index: i + 1,
                    title: format!("Chương {}", i + 1),
                    href: full_href,
                });
            }
        }
        Ok(chapters)
    }

    fn parse_ncx(ncx_xml: &str, opf_dir: &str) -> Result<Vec<ChapterInfo>, String> {
        let mut reader = Reader::from_str(ncx_xml);
        reader.config_mut().trim_text(true);

        let mut chapters = Vec::new();
        let mut cur_title = String::new();
        let mut in_text = false;
        let mut buf = Vec::new();

        loop {
            match &reader.read_event_into(&mut buf) {
                Ok(Event::Start(e)) => {
                    if e.local_name().as_ref() == b"text" {
                        in_text = true;
                    }
                }
                Ok(Event::Text(e)) => {
                    if in_text {
                        cur_title = e.unescape().unwrap_or_default().to_string();
                    }
                }
                Ok(Event::End(e)) => {
                    if e.local_name().as_ref() == b"text" {
                        in_text = false;
                    }
                }
                Ok(Event::Empty(e)) => {
                    if e.local_name().as_ref() == b"content" {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"src" {
                                let src = String::from_utf8_lossy(&attr.value).to_string();
                                let full_src = Self::resolve_path(opf_dir, &src);
                                let idx = chapters.len() + 1;
                                let title = if cur_title.is_empty() {
                                    format!("Chương {}", idx)
                                } else {
                                    cur_title.clone()
                                };
                                chapters.push(ChapterInfo {
                                    index: idx,
                                    title,
                                    href: full_src,
                                });
                                cur_title.clear();
                            }
                        }
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(format!("NCX error: {}", e)),
                _ => {}
            }
            buf.clear();
        }

        Ok(chapters)
    }

    fn resolve_path(base_dir: &str, file_path: &str) -> String {
        // Remove anchor fragment e.g. #page1
        let path_no_fragment = file_path.split('#').next().unwrap_or(file_path);
        if base_dir.is_empty() {
            path_no_fragment.replace('\\', "/")
        } else {
            let combined = PathBuf::from(base_dir).join(path_no_fragment);
            // normalize path
            combined
                .to_string_lossy()
                .to_string()
                .replace('\\', "/")
        }
    }

    fn read_zip_entry(archive: &mut ZipArchive<File>, name: &str) -> Result<String, String> {
        let bytes = Self::read_zip_entry_bytes(archive, name)?;
        String::from_utf8(bytes).map_err(|e| format!("UTF-8 decode error: {}", e))
    }

    fn read_zip_entry_bytes(archive: &mut ZipArchive<File>, name: &str) -> Result<Vec<u8>, String> {
        // Try exact name or case-insensitive search
        let norm_name = name.replace('\\', "/");
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let entry_name = file.name().replace('\\', "/");
            if entry_name == norm_name
                || entry_name.ends_with(&norm_name)
                || norm_name.ends_with(&entry_name)
            {
                let mut data = Vec::new();
                file.read_to_end(&mut data).map_err(|e| e.to_string())?;
                return Ok(data);
            }
        }
        Err(format!("Entry '{}' not found in zip", name))
    }
}
