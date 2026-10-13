CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  total_chapters INTEGER NOT NULL,
  current_chapter INTEGER DEFAULT 1,
  scroll_percent REAL DEFAULT 0,
  has_cover INTEGER DEFAULT 0,
  chapters_json TEXT NOT NULL,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS covers (
  book_id TEXT PRIMARY KEY,
  cover_data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  book_id TEXT NOT NULL,
  chapter_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (book_id, chapter_index)
);

CREATE TABLE IF NOT EXISTS book_chunks (
  book_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (book_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  book_title TEXT NOT NULL,
  chapter_index INTEGER NOT NULL,
  chapter_title TEXT NOT NULL,
  scroll_percent REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, book_id)
);
