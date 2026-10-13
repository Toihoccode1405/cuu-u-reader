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
  cover_url TEXT,
  chapters_json TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
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
