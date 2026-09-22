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
import { Book, UserProfile } from '../types';

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

  // ============================================================================
  // 推荐采纳反馈表 — "推得准不准"唯一的客观依据
  //
  // 只记用户显式点过的想读/跳过，不记"展示了哪些"，所以算不出严格采纳率
  // （缺分母）。要分母得在每次推荐响应时落一行，那是下一步的事。
  // book_id 故意不加外键：删书不该把历史信号一起删掉。
  // ============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS recommendation_feedback (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT NOT NULL,
      request_id  TEXT,             -- 同一次推荐响应的多条反馈归组
      book_id     TEXT,             -- 站内推荐的书；外部建议为空
      title       TEXT NOT NULL,
      source      TEXT NOT NULL,    -- 'library' | 'external'
      action      TEXT NOT NULL,    -- 'want' | 'skip'
      category    TEXT,             -- 反馈时的分类快照，用于按类推准率
      reason      TEXT,             -- 模型当时给的理由，用于复盘
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
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
    CREATE INDEX IF NOT EXISTS idx_rec_feedback_user_time ON recommendation_feedback(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_rec_feedback_user_book ON recommendation_feedback(user_id, book_id);
  `);

  console.log('[DB] SQLite initialized at:', dbPath);
}

// ============================================================================
// 书库数据访问 — 前端路由与 AI Agent 共用同一份真源
// ============================================================================

export interface BookRow {
  id: string;
  user_id: string;
  title: string;
  author: string;
  publisher: string | null;
  category: string;
  subcategory: string;
  tags: string | null;
  level: string;
  status: string;
  cover_color: string | null;
  cover_url: string | null;
  rating: number | null;
  douban_id: string | null;
  isbn: string | null;
  pub_date: string | null;
  publish_year: string | null;
  user_data: string | null;
  ai_insight: string | null;
  douban_data: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToBook(row: BookRow): any {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    publisher: row.publisher || undefined,
    category: row.category,
    subcategory: row.subcategory,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    level: row.level,
    status: row.status,
    coverColor: row.cover_color || undefined,
    coverUrl: row.cover_url || undefined,
    rating: row.rating ?? undefined,
    doubanId: row.douban_id || undefined,
    isbn: row.isbn || undefined,
    pubDate: row.pub_date || undefined,
    publishYear: row.publish_year || undefined,
    userData: row.user_data ? JSON.parse(row.user_data) : undefined,
    aiInsight: row.ai_insight ? JSON.parse(row.ai_insight) : undefined,
    doubanData: row.douban_data ? JSON.parse(row.douban_data) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 前端 Book 对象 → 数据库参数 */
export function bookToParams(userId: string, book: any) {
  return {
    id: book.id,
    user_id: userId,
    title: book.title,
    author: book.author,
    publisher: book.publisher || null,
    category: book.category || '未分类',
    subcategory: book.subcategory || 'General',
    tags: book.tags ? JSON.stringify(book.tags) : null,
    level: book.level || 'Basic',
    status: book.status || 'unread',
    cover_color: book.coverColor || null,
    cover_url: book.coverUrl || null,
    rating: book.rating ?? null,
    douban_id: book.doubanId || null,
    isbn: book.isbn || null,
    pub_date: book.pubDate || null,
    publish_year: book.publishYear || null,
    user_data: book.userData ? JSON.stringify(book.userData) : null,
    ai_insight: book.aiInsight ? JSON.stringify(book.aiInsight) : null,
    douban_data: book.doubanData ? JSON.stringify(book.doubanData) : null,
    created_at: book.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// SQL UPSERT 语句
export const UPSERT_BOOK_SQL = `
  INSERT INTO books (
    id, user_id, title, author, publisher, category, subcategory, tags,
    level, status, cover_color, cover_url, rating, douban_id, isbn,
    pub_date, publish_year, user_data, ai_insight, douban_data,
    created_at, updated_at
  ) VALUES (
    @id, @user_id, @title, @author, @publisher, @category, @subcategory, @tags,
    @level, @status, @cover_color, @cover_url, @rating, @douban_id, @isbn,
    @pub_date, @publish_year, @user_data, @ai_insight, @douban_data,
    @created_at, @updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    title=excluded.title, author=excluded.author, publisher=excluded.publisher,
    category=excluded.category, subcategory=excluded.subcategory, tags=excluded.tags,
    level=excluded.level, status=excluded.status, cover_color=excluded.cover_color,
    cover_url=excluded.cover_url, rating=excluded.rating, douban_id=excluded.douban_id,
    isbn=excluded.isbn, pub_date=excluded.pub_date, publish_year=excluded.publish_year,
    user_data=excluded.user_data, ai_insight=excluded.ai_insight,
    douban_data=excluded.douban_data, updated_at=excluded.updated_at
`;

export function loadUserLibrary(userId: string): Book[] {
  const rows = db
    .prepare('SELECT * FROM books WHERE user_id = ? ORDER BY created_at')
    .all(userId) as BookRow[];
  return rows.map(rowToBook);
}

/**
 * 只写 Agent 真正改过的列。整行 upsert 会把客户端快照里 Agent 没看到的字段
 * （例如刚被前端改掉的另一属性）一起冲掉。
 */
export function updateBookProgressInDb(
  userId: string,
  bookId: string,
  updates: { status?: string; rating?: number; userData?: any },
): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.rating !== undefined) { fields.push('rating = ?'); values.push(updates.rating); }
  if (updates.userData !== undefined) { fields.push('user_data = ?'); values.push(JSON.stringify(updates.userData)); }
  if (fields.length === 0) return false;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString(), bookId, userId);

  const result = db
    .prepare(`UPDATE books SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`)
    .run(...values);
  return result.changes > 0;
}

/** 画像行 → UserProfile；GET /api/profile、PUT 回包与 Agent 工具共用同一份映射 */
function rowToUserProfile(row: any): UserProfile {
  return {
    nickname: row.nickname || undefined,
    readingLevel: row.reading_level,
    readingGoal: row.reading_goal || undefined,
    preferredCategories: row.preferred_categories ? JSON.parse(row.preferred_categories) : [],
    dailyReadingTime: row.daily_reading_time ?? undefined,
    aiAnalysis: row.ai_analysis ? JSON.parse(row.ai_analysis) : undefined,
  };
}

/** 用户画像；不存在返回 undefined（AI 会以无画像模式运行） */
export function loadUserProfile(userId: string): UserProfile | undefined {
  const row = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId) as any;
  if (!row) return undefined;
  return rowToUserProfile(row);
}

/** 画像行的部分更新入参，字段名与 UserProfile 对齐 */
export interface UserProfilePatch {
  nickname?: string;
  readingLevel?: string;
  readingGoal?: string;
  preferredCategories?: string[];
  dailyReadingTime?: number;
  aiAnalysis?: any;
}

/**
 * 更新（或首次创建）用户画像，返回更新后的完整画像。
 * REST 的 PUT /api/profile 与 Agent 的 update_user_profile 工具共用这一份 SQL，
 * 否则两条写路径会各自漂移出一个字段来。
 */
export function updateUserProfileInDb(userId: string, patch: UserProfilePatch): UserProfile {
  db.prepare(`
    INSERT INTO user_profiles (user_id, reading_level) VALUES (?, 'beginner')
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId);

  const fields: string[] = [];
  const values: any[] = [];

  if (patch.nickname !== undefined) { fields.push('nickname = ?'); values.push(patch.nickname); }
  if (patch.readingLevel !== undefined) { fields.push('reading_level = ?'); values.push(patch.readingLevel); }
  if (patch.readingGoal !== undefined) { fields.push('reading_goal = ?'); values.push(patch.readingGoal); }
  if (patch.preferredCategories !== undefined) { fields.push('preferred_categories = ?'); values.push(JSON.stringify(patch.preferredCategories)); }
  if (patch.dailyReadingTime !== undefined) { fields.push('daily_reading_time = ?'); values.push(patch.dailyReadingTime); }
  if (patch.aiAnalysis !== undefined) { fields.push('ai_analysis = ?'); values.push(JSON.stringify(patch.aiAnalysis)); }

  if (fields.length > 0) {
    fields.push('updated_at = ?');
    values.push(new Date().toISOString(), userId);
    db.prepare(`UPDATE user_profiles SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);
  }

  return rowToUserProfile(db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId) as any);
}

// ============================================================================
// 推荐采纳反馈 — "这条推荐用户买不买账"的原始信号
// ============================================================================

export interface RecommendationFeedbackInput {
  requestId?: string | null;
  bookId?: string | null;
  title: string;
  source: 'library' | 'external';
  action: 'want' | 'skip';
  category?: string | null;
  reason?: string | null;
}

export interface RecommendationFeedbackRow {
  id: number;
  requestId: string | null;
  bookId: string | null;
  title: string;
  source: string;
  action: string;
  category: string | null;
  reason: string | null;
  createdAt: string;
}

/** 批量写入一次推荐里产生的反馈，返回实际写入条数 */
export function addRecommendationFeedback(
  userId: string,
  items: RecommendationFeedbackInput[],
): number {
  const stmt = db.prepare(`
    INSERT INTO recommendation_feedback (user_id, request_id, book_id, title, source, action, category, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAll = db.transaction((rows: RecommendationFeedbackInput[]) => {
    for (const r of rows) {
      stmt.run(
        userId,
        r.requestId ?? null,
        r.bookId ?? null,
        r.title,
        r.source,
        r.action,
        r.category ?? null,
        r.reason ? r.reason.slice(0, 500) : null,
      );
    }
    return rows.length;
  });
  return insertAll(items);
}

export function listRecommendationFeedback(userId: string, limit = 100): RecommendationFeedbackRow[] {
  const rows = db.prepare(`
    SELECT id, request_id, book_id, title, source, action, category, reason, created_at
    FROM recommendation_feedback WHERE user_id = ?
    ORDER BY id DESC LIMIT ?
  `).all(userId, Math.min(Math.max(limit, 1), 500)) as any[];
  return rows.map((r) => ({
    id: r.id,
    requestId: r.request_id,
    bookId: r.book_id,
    title: r.title,
    source: r.source,
    action: r.action,
    category: r.category,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

export default db;
