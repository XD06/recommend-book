/**
 * 书库 CRUD 路由 — 替换前端 localStorage
 *
 * 所有操作都需要认证，用户只能操作自己的数据
 */

import { Router } from 'express';
import { z } from 'zod';
import db from '../db/database';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../types';

const router = Router();

// 所有路由都需要登录
router.use(requireAuth);

// ============================================================================
// 辅助函数：数据库行 → 前端 Book 对象
// ============================================================================

interface BookRow {
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

function rowToBook(row: BookRow): any {
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
function bookToParams(userId: string, book: any) {
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
const UPSERT_SQL = `
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

// ============================================================================
// 获取书库（全量）
// ============================================================================

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM books WHERE user_id = ? ORDER BY created_at').all(req.user!.id) as BookRow[];
  const books = rows.map(rowToBook);
  res.json({ success: true, data: books });
});

// ============================================================================
// 获取单本书
// ============================================================================

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as BookRow | undefined;
  if (!row) {
    throw new AppError('BOOK_NOT_FOUND', '书籍不存在', 404);
  }
  res.json({ success: true, data: rowToBook(row) });
});

// ============================================================================
// 批量保存（全量同步 — 前端 localStorage 的替代方案）
// ============================================================================

const batchSaveSchema = z.object({
  books: z.array(z.any()),
});

router.post('/batch', (req, res) => {
  const { books } = batchSaveSchema.parse(req.body);
  const userId = req.user!.id;

  const upsert = db.prepare(UPSERT_SQL);

  // 事务：先删除用户所有书，再批量插入
  // 这样前端只需要把当前状态全量发过来，后端自动同步
  const tx = db.transaction((allBooks: any[]) => {
    // 先删除当前不在列表中的书
    const newIds = allBooks.map(b => b.id);
    if (newIds.length > 0) {
      const placeholders = newIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM books WHERE user_id = ? AND id NOT IN (${placeholders})`).run(userId, ...newIds);
    } else {
      db.prepare('DELETE FROM books WHERE user_id = ?').run(userId);
    }
    // Upsert 所有书
    for (const book of allBooks) {
      upsert.run(bookToParams(userId, book));
    }
  });

  tx(books);

  // 返回最新状态
  const rows = db.prepare('SELECT * FROM books WHERE user_id = ? ORDER BY created_at').all(userId) as BookRow[];
  res.json({ success: true, data: rows.map(rowToBook) });
});

// ============================================================================
// 新增 / 更新单本书
// ============================================================================

const upsertBookSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  publisher: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  tags: z.array(z.string()).optional(),
  level: z.string().optional(),
  status: z.string().optional(),
  coverColor: z.string().optional(),
  coverUrl: z.string().optional(),
  rating: z.number().optional(),
  doubanId: z.string().optional(),
  isbn: z.string().optional(),
  pubDate: z.string().optional(),
  publishYear: z.string().optional(),
  userData: z.any().optional(),
  aiInsight: z.any().optional(),
  doubanData: z.any().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

router.put('/:id', (req, res) => {
  const book = upsertBookSchema.parse({ ...req.body, id: req.params.id });
  const userId = req.user!.id;

  db.prepare(UPSERT_SQL).run(bookToParams(userId, book));

  const row = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(book.id, userId) as BookRow;
  res.json({ success: true, data: rowToBook(row) });
});

// ============================================================================
// 删除单本书
// ============================================================================

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM books WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  if (result.changes === 0) {
    throw new AppError('BOOK_NOT_FOUND', '书籍不存在', 404);
  }
  res.json({ success: true, data: { id: req.params.id } });
});

export default router;
