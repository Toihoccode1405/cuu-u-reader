mod epub;

use axum::{
    extract::{DefaultBodyLimit, Multipart, Path as AxumPath, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use epub::EpubParser;
use serde::{Deserialize, Serialize};
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::Mutex;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookRecord {
    pub id: String,
    pub title: String,
    pub author: String,
    pub total_chapters: usize,
    pub current_chapter: usize,
    pub scroll_percent: f32,
    pub has_cover: bool,
    pub file_size_mb: f32,
    pub added_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookDetail {
    #[serde(flatten)]
    pub record: BookRecord,
    pub chapters: Vec<epub::ChapterInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterContentResponse {
    pub book_id: String,
    pub chapter_index: usize,
    pub title: String,
    pub content_html: String,
    pub total_chapters: usize,
    pub prev_index: Option<usize>,
    pub next_index: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProgressRequest {
    pub chapter_index: usize,
    pub scroll_percent: f32,
}

#[derive(Clone)]
pub struct AppState {
    pub data_dir: PathBuf,
    pub books: Arc<Mutex<Vec<BookRecord>>>,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        fs::create_dir_all(data_dir.join("epubs")).unwrap();
        fs::create_dir_all(data_dir.join("covers")).unwrap();

        let books_json_path = data_dir.join("books.json");
        let initial_books = if books_json_path.exists() {
            let data = fs::read_to_string(&books_json_path).unwrap_or_default();
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            Vec::new()
        };

        Self {
            data_dir,
            books: Arc::new(Mutex::new(initial_books)),
        }
    }

    pub fn save_books(&self) {
        let books = self.books.lock();
        let path = self.data_dir.join("books.json");
        if let Ok(json_str) = serde_json::to_string_pretty(&*books) {
            let _ = fs::write(path, json_str);
        }
    }
}

#[tokio::main]
async fn main() {
    let data_dir = PathBuf::from("data");
    let state = AppState::new(data_dir);

    // Build routes
    let api_routes = Router::new()
        .route("/books", get(list_books))
        .route("/books/upload", post(upload_book))
        .route("/books/:id", get(get_book_detail))
        .route("/books/:id", delete(delete_book))
        .route("/books/:id/cover", get(get_book_cover))
        .route("/books/:id/progress", post(update_progress))
        .route("/books/:id/chapters/:index", get(get_chapter_content))
        .layer(DefaultBodyLimit::max(250 * 1024 * 1024)); // 250MB upload limit

    // Frontend static files (React SPA dist)
    let frontend_dir = if PathBuf::from("../reader_frontend/dist").exists() {
        PathBuf::from("../reader_frontend/dist")
    } else {
        PathBuf::from("../frontend")
    };
    let app = Router::new()
        .nest("/api", api_routes)
        .nest_service("/", ServeDir::new(&frontend_dir))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state);

    let port = 8080;
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("============================================================");
    println!("   📖 CỬU U THƯ CÁC - RUST NOVEL READER ENGINE");
    println!("   Server đang chạy tại: http://localhost:{}", port);
    println!("   Hỗ trợ đọc trơn tru trên cả PC và Mobile.");
    println!("============================================================");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// -----------------------------------------------------------------------------
// API Handlers
// -----------------------------------------------------------------------------

async fn list_books(State(state): State<AppState>) -> Json<Vec<BookRecord>> {
    let books = state.books.lock().clone();
    Json(books)
}

async fn get_book_detail(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<BookDetail>, (StatusCode, String)> {
    let record = {
        let books = state.books.lock();
        books
            .iter()
            .find(|b| b.id == id)
            .cloned()
            .ok_or((StatusCode::NOT_FOUND, "Book not found".to_string()))?
    };

    let epub_path = state.data_dir.join("epubs").join(format!("{}.epub", id));
    let parsed = EpubParser::parse_file(&epub_path).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(BookDetail {
        record,
        chapters: parsed.chapters,
    }))
}

async fn get_book_cover(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    let cover_jpg = state.data_dir.join("covers").join(format!("{}.jpg", id));
    let cover_png = state.data_dir.join("covers").join(format!("{}.png", id));

    if cover_jpg.exists() {
        if let Ok(bytes) = fs::read(&cover_jpg) {
            return ([(header::CONTENT_TYPE, "image/jpeg")], bytes).into_response();
        }
    } else if cover_png.exists() {
        if let Ok(bytes) = fs::read(&cover_png) {
            return ([(header::CONTENT_TYPE, "image/png")], bytes).into_response();
        }
    }

    (StatusCode::NOT_FOUND, "No cover found").into_response()
}

async fn upload_book(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<BookRecord>, (StatusCode, String)> {
    while let Some(field) = multipart.next_field().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))? {
        let name = field.name().unwrap_or_default().to_string();
        if name == "file" || name == "epub" {
            let data = field.bytes().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let file_size_mb = data.len() as f32 / (1024.0 * 1024.0);

            let book_id = Uuid::new_v4().to_string();
            let epub_path = state.data_dir.join("epubs").join(format!("{}.epub", book_id));

            fs::write(&epub_path, &data).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            // Parse metadata
            let metadata = EpubParser::parse_file(&epub_path)
                .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid EPUB: {}", e)))?;

            // Extract cover if present
            let mut has_cover = false;
            if let Some(ref cover_href) = metadata.cover_image {
                if let Ok(cover_bytes) = EpubParser::extract_cover(&epub_path, cover_href) {
                    let ext = if cover_href.ends_with(".png") { "png" } else { "jpg" };
                    let cover_path = state.data_dir.join("covers").join(format!("{}.{}", book_id, ext));
                    if fs::write(cover_path, cover_bytes).is_ok() {
                        has_cover = true;
                    }
                }
            }

            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();

            let record = BookRecord {
                id: book_id,
                title: metadata.title,
                author: metadata.author,
                total_chapters: metadata.chapters.len(),
                current_chapter: 1,
                scroll_percent: 0.0,
                has_cover,
                file_size_mb,
                added_at: timestamp,
            };

            {
                let mut books = state.books.lock();
                books.push(record.clone());
            }
            state.save_books();

            return Ok(Json(record));
        }
    }

    Err((StatusCode::BAD_REQUEST, "Missing file field".to_string()))
}

async fn update_progress(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(payload): Json<UpdateProgressRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    {
        let mut books = state.books.lock();
        if let Some(book) = books.iter_mut().find(|b| b.id == id) {
            book.current_chapter = payload.chapter_index;
            book.scroll_percent = payload.scroll_percent;
        } else {
            return Err((StatusCode::NOT_FOUND, "Book not found".to_string()));
        }
    }
    state.save_books();
    Ok(StatusCode::OK)
}

async fn get_chapter_content(
    State(state): State<AppState>,
    AxumPath((id, index)): AxumPath<(String, usize)>,
) -> Result<Json<ChapterContentResponse>, (StatusCode, String)> {
    let epub_path = state.data_dir.join("epubs").join(format!("{}.epub", id));
    if !epub_path.exists() {
        return Err((StatusCode::NOT_FOUND, "Book file missing".to_string()));
    }

    let parsed = EpubParser::parse_file(&epub_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let total = parsed.chapters.len();
    if index == 0 || index > total {
        return Err((StatusCode::NOT_FOUND, "Invalid chapter index".to_string()));
    }

    let ch_meta = &parsed.chapters[index - 1];
    let raw_content = EpubParser::read_chapter_content(&epub_path, &ch_meta.href)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // Clean XHTML: extract body contents only
    let clean_html = clean_chapter_html(&raw_content);

    let prev_index = if index > 1 { Some(index - 1) } else { None };
    let next_index = if index < total { Some(index + 1) } else { None };

    Ok(Json(ChapterContentResponse {
        book_id: id,
        chapter_index: index,
        title: ch_meta.title.clone(),
        content_html: clean_html,
        total_chapters: total,
        prev_index,
        next_index,
    }))
}

async fn delete_book(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    {
        let mut books = state.books.lock();
        if let Some(pos) = books.iter().position(|b| b.id == id) {
            books.remove(pos);
        } else {
            return Err((StatusCode::NOT_FOUND, "Book not found".to_string()));
        }
    }
    state.save_books();

    // Clean files
    let _ = fs::remove_file(state.data_dir.join("epubs").join(format!("{}.epub", id)));
    let _ = fs::remove_file(state.data_dir.join("covers").join(format!("{}.jpg", id)));
    let _ = fs::remove_file(state.data_dir.join("covers").join(format!("{}.png", id)));

    Ok(StatusCode::OK)
}

fn clean_chapter_html(raw: &str) -> String {
    // Extract everything between <body> and </body> if present
    if let Some(start) = raw.find("<body") {
        if let Some(tag_end) = raw[start..].find('>') {
            let body_start = start + tag_end + 1;
            if let Some(body_end) = raw.rfind("</body>") {
                let inner = &raw[body_start..body_end];
                return strip_scripts(inner);
            }
        }
    }
    strip_scripts(raw)
}

fn strip_scripts(s: &str) -> String {
    // Simple script removal
    let mut result = s.to_string();
    while let Some(start) = result.find("<script") {
        if let Some(end) = result[start..].find("</script>") {
            result.replace_range(start..start + end + 9, "");
        } else {
            break;
        }
    }
    result
}
