/**
 * SQLite 数据库初始化
 *
 * 使用 better-sqlite3，零安装、文件型数据库
 * 数据文件：backend/data/deepread.db
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// 确保数据目录存在
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'deepread.db');

const db: DatabaseType = new Database(dbPath);

// 启用 WAL 模式（更好的并发读写性能）
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * 初始化所有表
 */
export function initDatabase(): void {
  // ============================================================================
  // 用户表
  // ============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ============================================================================
  // 书库表（每用户独立）
  // ============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      title         TEXT NOT NULL,
      author        TEXT NOT NULL,
      publisher     TEXT,
      category      TEXT NOT NULL DEFAULT '未分类',
      subcategory   TEXT NOT NULL DEFAULT 'General',
      tags          TEXT,          -- JSON array
      level         TEXT NOT NULL DEFAULT 'Basic',
      status        TEXT NOT NULL DEFAULT 'unread',
      cover_color   TEXT,
      cover_url     TEXT,
      rating        REAL,
      douban_id     TEXT,
      isbn          TEXT,
      pub_date      TEXT,
      publish_year  TEXT,
      user_data     TEXT,          -- JSON: UserProgress
      ai_insight    TEXT,          -- JSON: AIInsight
      douban_data   TEXT,          -- JSON: DoubanBookData
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // ============================================================================
  // 用户画像表
  // ============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id             TEXT PRIMARY KEY,
      nickname            TEXT,
      reading_level       TEXT NOT NULL DEFAULT 'beginner',
      reading_goal        TEXT,
      preferred_categories TEXT,   -- JSON array
      daily_reading_time  INTEGER,
      ai_analysis         TEXT,    -- JSON
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // ============================================================================
  // 对话历史表（AI 多轮对话上下文）
  // ============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      book_id     TEXT,             -- 可空：书籍专属问答时关联
      type        TEXT NOT NULL,    -- 'book_qa' | 'reading_assistant' | 'ai_advisor'
      messages    TEXT NOT NULL,    -- JSON array of { role, content }
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );
  `);

  // ============================================================================
  // 分类元数据表
  // ============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS category_meta (
      user_id       TEXT NOT NULL,
      category_name TEXT NOT NULL,
      meta          TEXT NOT NULL,   -- JSON: CategoryMeta
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, category_name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_books_user_id ON books(user_id);
    CREATE INDEX IF NOT EXISTS idx_books_user_status ON books(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_books_user_category ON books(user_id, category);
    CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_user_book ON conversations(user_id, book_id);
  `);

  console.log('[DB] SQLite initialized at:', dbPath);
}

export default db;
