/**
 * 书库 CRUD 路由 — 替换前端 localStorage
 *
 * 所有操作都需要认证，用户只能操作自己的数据
 */

import { Router } from 'express';
import { z } from 'zod';
import db, {
  BookRow,
  rowToBook,
  bookToParams,
  UPSERT_BOOK_SQL,
  loadUserLibrary,
} from '../db/database';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../types';

const router = Router();

// 所有路由都需要登录
router.use(requireAuth);

// ============================================================================
// 获取书库（全量）
// ============================================================================

router.get('/', (req, res, next) => {
  try {
    const books = loadUserLibrary(req.user!.id);
    res.json({ success: true, data: books });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 获取单本书
// ============================================================================

router.get('/:id', (req, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as BookRow | undefined;
    if (!row) {
      throw new AppError('BOOK_NOT_FOUND', '书籍不存在', 404);
    }
    res.json({ success: true, data: rowToBook(row) });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 批量保存（全量同步 — 前端 localStorage 的替代方案）
// ============================================================================

const batchSaveSchema = z.object({
  books: z.array(z.any()),
});

router.post('/batch', (req, res, next) => {
  try {
    const { books } = batchSaveSchema.parse(req.body);
    const userId = req.user!.id;

    const upsert = db.prepare(UPSERT_BOOK_SQL);

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
    res.json({ success: true, data: loadUserLibrary(userId) });
  } catch (err) {
    next(err);
  }
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

router.put('/:id', (req, res, next) => {
  try {
    const book = upsertBookSchema.parse({ ...req.body, id: req.params.id });
    const userId = req.user!.id;

    db.prepare(UPSERT_BOOK_SQL).run(bookToParams(userId, book));

    const row = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(book.id, userId) as BookRow;
    res.json({ success: true, data: rowToBook(row) });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 删除单本书
// ============================================================================

router.delete('/:id', (req, res, next) => {
  try {
    const result = db.prepare('DELETE FROM books WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
    if (result.changes === 0) {
      throw new AppError('BOOK_NOT_FOUND', '书籍不存在', 404);
    }
    res.json({ success: true, data: { id: req.params.id } });
  } catch (err) {
    next(err);
  }
});

export default router;
