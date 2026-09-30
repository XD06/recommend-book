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
import { randomUUID } from 'crypto';
import { Book, UserProfile, ProfileFieldMeta, ProfileFieldSource } from '../types';

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

  // ============================================================================
  // 画像字段来源表 — 区分"用户自己说的"与"AI 推测的"
  //
  // 加新表不受"没有迁移系统"的限制（每次启动都跑 CREATE TABLE IF NOT EXISTS）。
  // 为什么必须分开记：用户填的是期望（权威但可能粗糙），AI 记录的是猜测（可能准但
  // 必须可修正）。混在一起就会出现"AI 把自己的推断当成用户要求，还覆盖掉用户填的"。
  // 字段维度用行存（而不是给 user_profiles 加列），因为改已有表结构在本仓库没有出路。
  // ============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile_field_meta (
      user_id    TEXT NOT NULL,
      field      TEXT NOT NULL,   -- readingLevel | readingGoal | preferredCategories | dailyReadingTime | nickname
      source     TEXT NOT NULL,   -- 'user' | 'ai'
      via        TEXT,            -- 'form' | 'conversation'（仅 source='user'）
      evidence   TEXT,            -- 写入依据（用户原话片段）
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, field),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // ============================================================================
  // 画像写入日志 — 追加式，是"可撤销 + 可审计"的地基
  //
  // 为什么不能只靠 profile_field_meta：那张表只记"当前是谁写的"，撤不回上一步。
  // 每行记下"改之前是什么"（值 + 来源 + 渠道 + 依据），于是撤销就是一次精确还原。
  // 追加不 UPSERT：改选历史本身有价值（谁在什么时候把什么改成了什么）。
  // ============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile_write_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT NOT NULL,
      field         TEXT NOT NULL,
      prev_value    TEXT,            -- JSON；NULL = 此前该字段没有值
      next_value    TEXT,            -- JSON
      source        TEXT NOT NULL,   -- 本次写入的来源 user|ai
      via           TEXT,
      evidence      TEXT,
      prev_source   TEXT,            -- 写入前的来源；NULL = 此前从未被写过
      prev_via      TEXT,
      prev_evidence TEXT,
      origin        TEXT NOT NULL,   -- form | conversation | tool | extract
      undone_at     TEXT,
      created_at    TEXT NOT NULL,
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
  const userData = row.user_data ? JSON.parse(row.user_data) : undefined;
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
    // 用户自评从 user_data 里提出来，消费方不必记得它藏在 JSON 里
    userRating: userData?.userRating,
    doubanId: row.douban_id || undefined,
    isbn: row.isbn || undefined,
    pubDate: row.pub_date || undefined,
    publishYear: row.publish_year || undefined,
    userData,
    aiInsight: row.ai_insight ? JSON.parse(row.ai_insight) : undefined,
    doubanData: row.douban_data ? JSON.parse(row.douban_data) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * user_data 是用户侧 JSON（阅读进度 + 自评星级）。
 *
 * 星级只存在这里，就不必给 books 加列 —— 本仓库没有迁移系统，
 * `CREATE TABLE IF NOT EXISTS` 对已存在的表不生效，加列要手工 ALTER。
 */
function buildUserDataJson(book: any): string | null {
  const base = book.userData ? { ...book.userData } : {};
  if (book.userRating !== undefined && book.userRating !== null) {
    base.userRating = book.userRating;
  }
  return Object.keys(base).length > 0 ? JSON.stringify(base) : null;
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
    user_data: buildUserDataJson(book),
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
 *
 * 自评星级与阅读进度同住 `user_data`，所以写其中一个都要带上另一个，
 * 否则会把刚写入的进度或星级互相覆盖。
 */
export function updateBookProgressInDb(
  userId: string,
  bookId: string,
  updates: { status?: string; userRating?: number; userData?: any },
): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }

  if (updates.userData !== undefined || updates.userRating !== undefined) {
    let merged: any = updates.userData;
    if (merged === undefined) {
      const row = db.prepare('SELECT user_data FROM books WHERE id = ? AND user_id = ?').get(bookId, userId) as any;
      merged = row?.user_data ? JSON.parse(row.user_data) : { totalPages: 0, currentPage: 0, progressPercentage: 0 };
    }
    merged = { ...merged };
    if (updates.userRating !== undefined) merged.userRating = updates.userRating;
    fields.push('user_data = ?');
    values.push(JSON.stringify(merged));
  }

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
    updatedAt: row.updated_at || undefined,
    aiAnalysis: row.ai_analysis ? JSON.parse(row.ai_analysis) : undefined,
  };
}

/** 用户画像；不存在返回 undefined（AI 会以无画像模式运行） */
export function loadUserProfile(userId: string): UserProfile | undefined {
  const row = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId) as any;
  if (!row) return undefined;
  return { ...rowToUserProfile(row), fieldMeta: loadProfileFieldMeta(userId) };
}

/** 逐字段来源元数据；从未写过的字段不在返回里 */
export function loadProfileFieldMeta(userId: string): Record<string, ProfileFieldMeta> {
  const rows = db.prepare(
    'SELECT field, source, via, evidence, updated_at FROM profile_field_meta WHERE user_id = ?',
  ).all(userId) as any[];
  const out: Record<string, ProfileFieldMeta> = {};
  for (const r of rows) {
    out[r.field] = {
      source: r.source as ProfileFieldSource,
      via: r.via || undefined,
      evidence: r.evidence || undefined,
      updatedAt: r.updated_at || undefined,
    };
  }
  return out;
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
 * 被跟踪来源的画像字段 → 数据库列。
 * `aiAnalysis` 不在其中：它本身就是 AI 生成的产物，没有"用户填的版本"可覆盖。
 */
const PROFILE_FIELD_COLUMNS: Record<string, string> = {
  nickname: 'nickname',
  readingLevel: 'reading_level',
  readingGoal: 'reading_goal',
  preferredCategories: 'preferred_categories',
  dailyReadingTime: 'daily_reading_time',
};

export interface ProfileWriteOptions {
  /** 谁在写：设置页表单是 'user'，AI 在对话里明确听到用户陈述也是 'user'，AI 推测是 'ai' */
  source: ProfileFieldSource;
  via?: 'form' | 'conversation';
  /** 写入依据（用户原话片段） */
  evidence?: string;
  /** 触发路径，仅用于日志与展示：表单 / 对话里的工具调用 / 回合后抽取 */
  origin?: 'form' | 'conversation' | 'tool' | 'extract';
}

export interface ProfileWriteResult {
  profile: UserProfile;
  written: string[];
  /** 被拒绝的字段：用户填过的（权威）不允许被 AI 推测覆盖 */
  refused: Array<{ field: string; reason: string }>;
  /** 本次写入对应的日志行，交给前端做"撤销" */
  logged: Array<{ field: string; logId: number }>;
}

/** 判断"值没变"，避免同值写入把来源从 user 降级成 ai 或反过来刷掉依据 */
function isSameProfileValue(field: string, current: any, next: any): boolean {
  if (field === 'preferredCategories') {
    const a = Array.isArray(current) ? current.map(String).sort() : [];
    const b = Array.isArray(next) ? next.map(String).sort() : [];
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  if (typeof current === 'string' || typeof next === 'string') {
    return String(current ?? '').trim() === String(next ?? '').trim();
  }
  return current === next;
}

/**
 * 更新（或首次创建）用户画像。REST 的 PUT /api/profile 与 Agent 的
 * update_user_profile 工具共用这一份 SQL，否则两条写路径会各自漂移出一个字段来。
 *
 * **来源保护规则**（这是本函数存在两套调用方的核心理由）：
 * - `source: 'ai'` 只能填**没写过**的字段，或改**自己之前写的**字段；一旦某字段的
 *   来源是 `'user'`（用户填的期望），AI 就不得覆盖 —— 命中的字段进 `refused` 原样返回，
 *   让模型能如实告诉用户"这条是你自己定的，我改不了"。
 * - `source: 'user'` 可以覆盖任何来源（用户当然可以改自己的期望）。用户在对话里
 *   明确说出的值也走这条：那是用户的话，不是 AI 的推测，只是 `via` 记为 'conversation'。
 * - 同值写入直接跳过，不改变来源、不覆盖依据。
 */
export function updateUserProfileInDb(
  userId: string,
  patch: UserProfilePatch,
  options: ProfileWriteOptions = { source: 'user', via: 'form' },
): ProfileWriteResult {
  db.prepare(`
    INSERT INTO user_profiles (user_id, reading_level) VALUES (?, 'beginner')
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId);

  const meta = loadProfileFieldMeta(userId);
  const current: any = rowToUserProfile(db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId) as any);

  const fields: string[] = [];
  const values: any[] = [];
  const written: string[] = [];
  const refused: Array<{ field: string; reason: string }> = [];
  const logged: Array<{ field: string; logId: number }> = [];
  const metaWrites: Array<{ field: string; source: ProfileFieldSource }> = [];

  for (const [field, column] of Object.entries(PROFILE_FIELD_COLUMNS)) {
    const next = (patch as any)[field];
    if (next === undefined) continue;   // patch 语义：没传就不动

    const existing = meta[field];
    const sameValue = isSameProfileValue(field, current[field], next);

    // 用户填过 / 用户在对话里说过的字段，不接受 AI 的推测覆盖
    if (options.source === 'ai' && existing?.source === 'user') {
      if (sameValue) continue;   // 同值：无需改，也不必报"被拒绝"
      refused.push({
        field,
        reason: existing.via === 'conversation'
          ? '该字段是用户此前在对话里明确说过的，不能被你这次新的推测覆盖'
          : '该字段由用户自己在设置页填写，不能被你覆盖',
      });
      continue;
    }

    // 同值且来源不变 → 什么都不做：既不刷 updated_at（它驱动"画像是否过时"的判断），
    // 也不让后一次的重复上报覆盖掉先前的依据
    if (sameValue && existing?.source === options.source) continue;

    fields.push(`${column} = ?`);
    values.push(field === 'preferredCategories' ? JSON.stringify(next) : next);
    written.push(field);
    metaWrites.push({ field, source: options.source });
  }

  // aiAnalysis 不走来源跟踪：它只能由 AI 生成
  if (patch.aiAnalysis !== undefined) {
    fields.push('ai_analysis = ?');
    values.push(JSON.stringify(patch.aiAnalysis));
    written.push('aiAnalysis');
  }

  if (fields.length > 0) {
    const now = new Date().toISOString();
    fields.push('updated_at = ?');
    values.push(now, userId);
    db.prepare(`UPDATE user_profiles SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);

    const upsertMeta = db.prepare(`
      INSERT INTO profile_field_meta (user_id, field, source, via, evidence, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, field) DO UPDATE SET
        source = excluded.source, via = excluded.via,
        evidence = excluded.evidence, updated_at = excluded.updated_at
    `);
    // 追加式日志：把"改之前是什么"一起记下来，撤销才能精确还原
    const insertLog = db.prepare(`
      INSERT INTO profile_write_log
        (user_id, field, prev_value, next_value, source, via, evidence,
         prev_source, prev_via, prev_evidence, origin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const origin = options.origin ?? (options.source === 'user' ? (options.via === 'conversation' ? 'conversation' : 'form') : 'tool');

    for (const m of metaWrites) {
      upsertMeta.run(
        userId, m.field, m.source,
        m.source === 'user' ? (options.via ?? 'form') : null,
        options.evidence ? options.evidence.slice(0, 200) : null,
        now,
      );
      const before = meta[m.field];
      const info = insertLog.run(
        userId, m.field,
        current[m.field] === undefined ? null : JSON.stringify(current[m.field]),
        JSON.stringify((patch as any)[m.field]),
        options.source,
        options.source === 'user' ? (options.via ?? 'form') : null,
        options.evidence ? options.evidence.slice(0, 200) : null,
        before?.source ?? null, before?.via ?? null, before?.evidence ?? null,
        origin, now,
      );
      logged.push({ field: m.field, logId: Number(info.lastInsertRowid) });
    }
  }

  return {
    profile: loadUserProfile(userId)!,
    written,
    refused,
    logged,
  };
}

// ============================================================================
// 画像写入日志：列表 + 撤销
// ============================================================================

export interface ProfileWriteLogRow {
  id: number;
  field: string;
  prevValue: any;
  nextValue: any;
  source: string;
  via: string | null;
  evidence: string | null;
  origin: string;
  undoneAt: string | null;
  createdAt: string;
}

export function listProfileWriteLog(userId: string, limit = 30): ProfileWriteLogRow[] {
  const rows = db.prepare(`
    SELECT id, field, prev_value, next_value, source, via, evidence, origin, undone_at, created_at
    FROM profile_write_log WHERE user_id = ? ORDER BY id DESC LIMIT ?
  `).all(userId, Math.min(Math.max(limit, 1), 200)) as any[];
  return rows.map((r) => ({
    id: r.id,
    field: r.field,
    prevValue: r.prev_value === null ? null : JSON.parse(r.prev_value),
    nextValue: r.next_value === null ? null : JSON.parse(r.next_value),
    source: r.source,
    via: r.via,
    evidence: r.evidence,
    origin: r.origin,
    undoneAt: r.undone_at,
    createdAt: r.created_at,
  }));
}

/**
 * 撤销一次画像写入：把值和来源都还原成写入前的样子。
 *
 * 两个必须处理的边界：
 * - `reading_level` 是 NOT NULL 列，不能还原成 NULL —— 回到默认值 'beginner'，
 *   并删掉来源行，让它重新处于"数据库默认值、用户未确认"的状态（这正是它当初的状态）。
 * - 写入前没有来源行（此前从未写过）时，撤销要**删除**来源行而不是写一行空值，
 *   否则该字段会被误判成"AI 记录过"，从此不再算"默认值"。
 */
export function undoProfileWrite(userId: string, logId: number): { restored: boolean; field?: string; error?: string } {
  const row = db.prepare('SELECT * FROM profile_write_log WHERE id = ? AND user_id = ?').get(logId, userId) as any;
  if (!row) return { restored: false, error: '找不到这条记录' };
  if (row.undone_at) return { restored: false, error: '这条改动已经撤销过了' };

  const column = PROFILE_FIELD_COLUMNS[row.field];
  if (!column) return { restored: false, error: `字段 ${row.field} 不支持撤销` };

  let prev: any = row.prev_value === null ? null : JSON.parse(row.prev_value);
  if (row.field === 'readingLevel' && prev === null) prev = 'beginner';

  const now = new Date().toISOString();
  const restore = db.transaction(() => {
    db.prepare(`UPDATE user_profiles SET ${column} = ?, updated_at = ? WHERE user_id = ?`)
      .run(row.field === 'preferredCategories' && prev !== null ? JSON.stringify(prev) : prev, now, userId);

    if (row.prev_source) {
      db.prepare(`
        INSERT INTO profile_field_meta (user_id, field, source, via, evidence, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, field) DO UPDATE SET
          source = excluded.source, via = excluded.via,
          evidence = excluded.evidence, updated_at = excluded.updated_at
      `).run(userId, row.field, row.prev_source, row.prev_via, row.prev_evidence, now);
    } else {
      db.prepare('DELETE FROM profile_field_meta WHERE user_id = ? AND field = ?').run(userId, row.field);
    }

    db.prepare('UPDATE profile_write_log SET undone_at = ? WHERE id = ?').run(now, logId);
  });
  restore();

  return { restored: true, field: row.field };
}

// ============================================================================
// 推荐采纳反馈 — "这条推荐用户买不买账"的原始信号
// ============================================================================

export interface RecommendationFeedbackInput {
  requestId?: string | null;
  bookId?: string | null;
  title: string;
  source: 'library' | 'external';
  /**
   * 用户显式点击只有 want / skip；`shown` 由服务端在每次推荐响应时写入，
   * 用来补上"这次一共推了哪些"的分母 —— 没有它就只能算"点了什么"，
   * 算不出严格采纳率（见 CHANGELOG「推荐采纳反馈」条）。
   */
  action: 'want' | 'skip' | 'shown';
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

export interface RecommendationFeedbackSummary {
  /** 最近的想读（同一本书改选只留最新态度） */
  want: Array<{ title: string; category: string | null }>;
  /** 最近的跳过 */
  skip: Array<{ title: string; category: string | null }>;
  shownCount: number;
  wantCount: number;
  skipCount: number;
}

/**
 * 读回采纳信号 —— 这张表建好之后一直只有写入方，推荐链路从不读它，
 * 于是"用户的反馈"对下一次推荐毫无影响。这个函数是读取端。
 *
 * 两类信号**分开取，不能同窗统计**：一次推荐就写 3–7 条 `shown`，而点击是零星的，
 * 用同一个 LIMIT 窗口会让很早之前的想读/跳过被展示记录挤出窗口。所以态度看最近
 * limit 条"点击"，分母看展示总数。
 *
 * 口径补充：同一本书改选过就只认最新一条（表里追加不 UPSERT，
 * 按 id 倒序取首次出现即为最新态度）。
 */
export function summarizeRecommendationFeedback(userId: string, limit = 200): RecommendationFeedbackSummary {
  const rows = db.prepare(`
    SELECT title, category, action FROM recommendation_feedback
    WHERE user_id = ? AND action IN ('want', 'skip')
    ORDER BY id DESC LIMIT ?
  `).all(userId, Math.min(Math.max(limit, 1), 1000)) as any[];

  const counts = db.prepare(`
    SELECT
      SUM(action = 'shown') AS shown,
      SUM(action = 'want')  AS want,
      SUM(action = 'skip')  AS skip
    FROM recommendation_feedback WHERE user_id = ?
  `).get(userId) as any;

  const want: Array<{ title: string; category: string | null }> = [];
  const skip: Array<{ title: string; category: string | null }> = [];
  const seen = new Set<string>();

  for (const r of rows) {
    const key = String(r.title || '').trim();
    if (!key || seen.has(key)) continue;   // 倒序遍历，首次出现即最新态度
    seen.add(key);
    if (r.action === 'want') want.push({ title: key, category: r.category ?? null });
    else if (r.action === 'skip') skip.push({ title: key, category: r.category ?? null });
  }

  return {
    want: want.slice(0, 12),
    skip: skip.slice(0, 12),
    shownCount: Number(counts?.shown) || 0,
    wantCount: Number(counts?.want) || 0,
    skipCount: Number(counts?.skip) || 0,
  };
}

// ============================================================================
// 对话历史 — AI 顾问的会话记忆
//
// 表早就建了（含两个索引），但从来没有写入方：前端把历史存在 localStorage、
// 只留最后 10 轮，换设备或清缓存就归零，"下次推荐时围绕这个目标"是句空话。
// 这里补上读写口，一个用户一个 type 只保留一条会话。
// ============================================================================

export interface StoredConversation {
  id: string;
  bookId: string | null;
  type: string;
  /** JSON blob：形状由调用方决定（AI 顾问存整轮对话，BookQA 存 role/content） */
  messages: any[];
  createdAt: string;
  updatedAt: string;
}

/** 覆盖式保存一份会话（同一 user+type 只留一条） */
export function saveConversation(
  userId: string,
  type: string,
  messages: any[],
  bookId: string | null = null,
): StoredConversation {
  const now = new Date().toISOString();
  const existing = loadConversation(userId, type, bookId);
  const payload = JSON.stringify(messages ?? []);

  if (existing) {
    db.prepare('UPDATE conversations SET messages = ?, updated_at = ? WHERE id = ?')
      .run(payload, now, existing.id);
    return { ...existing, messages, updatedAt: now };
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO conversations (id, user_id, book_id, type, messages, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, bookId, type, payload, now, now);
  return { id, bookId, type, messages, createdAt: now, updatedAt: now };
}

export function loadConversation(
  userId: string,
  type: string,
  bookId: string | null = null,
): StoredConversation | null {
  const row = db.prepare(`
    SELECT id, book_id, type, messages, created_at, updated_at FROM conversations
    WHERE user_id = ? AND type = ? AND IFNULL(book_id, '') = IFNULL(?, '')
    ORDER BY updated_at DESC LIMIT 1
  `).get(userId, type, bookId) as any;
  if (!row) return null;
  return {
    id: row.id,
    bookId: row.book_id,
    type: row.type,
    messages: row.messages ? JSON.parse(row.messages) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function clearConversation(userId: string, type: string, bookId: string | null = null): number {
  const r = db.prepare(`
    DELETE FROM conversations
    WHERE user_id = ? AND type = ? AND IFNULL(book_id, '') = IFNULL(?, '')
  `).run(userId, type, bookId);
  return r.changes;
}

export default db;
