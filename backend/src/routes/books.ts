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
  addActivities,
  addActivity,
  listActivities,
  backfillActivities,
  type ActivityType,
} from '../db/database';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../types';
import { refetchBookDetail, doubanDataScore } from '../services/doubanService';
import type { DoubanBookData } from '../types';

const router = Router();

// 所有路由都需要登录
router.use(requireAuth);

// ============================================================================
// 获取书库（全量）
// ============================================================================

router.get('/', (req, res, next) => {
  try {
    const userId = req.user!.id;
    // 存量回填：老用户的书库没有历史动态，访问时按类型补齐。
    // 内部对 added / started / finished 各自判断是否已存在，重复调用安全。
    const backfilled = backfillActivities(userId);
    if (backfilled > 0) {
      console.log(`[Activity] 已为 ${userId} 回填 ${backfilled} 条历史动态`);
    }
    const books = loadUserLibrary(userId);
    res.json({ success: true, data: books });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 阅读动态（书库操作流水）
//
// 必须排在 `GET /:id` **之前**：Express 按注册顺序匹配，否则 "activities"
// 会被当成一个 bookId 命中 /:id，永远走到 404。
// ============================================================================

router.get('/activities', (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    res.json({ success: true, data: listActivities(req.user!.id, limit) });
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

export interface BookSnapshot {
  title: string;
  status: string;
}

/**
 * 对比保存前后的书库，把变化记成动态。
 *
 * 为什么必须在**服务端**做 diff：整库保存是前端把全量状态推上来，
 * 服务端只有"旧库"和"新库"两份快照，这是唯一能同时看到两边的时刻。
 * 前端做不了——它拿不到"服务端当前是什么"（可能已被 AI 工具改过）。
 *
 * 只记四类事件，其余改动（改书名、改分类、改评分）不算"动态"：
 * 用户打开动态是想看"书库发生了什么"，而不是一份审计日志。
 */
export function recordLibraryDiff(
  userId: string,
  before: Map<string, BookSnapshot>,
  after: Array<{ id: string; title: string; status: string }>,
): void {
  const afterIds = new Set(after.map((b) => b.id));
  const events: Array<{ bookId: string | null; bookTitle: string; type: ActivityType }> = [];

  for (const b of after) {
    if (!before.has(b.id)) {
      events.push({ bookId: b.id, bookTitle: b.title, type: 'added' });
    }
  }

  // 删除事件的书名必须取自**旧快照**：新载荷里已经没有这本书了
  for (const [id, snap] of before) {
    if (!afterIds.has(id)) {
      events.push({ bookId: id, bookTitle: snap.title, type: 'deleted' });
    }
  }

  for (const b of after) {
    const prev = before.get(b.id);
    if (!prev || prev.status === b.status) continue;
    // 只在"进入"这两个状态时记，退回 unread 不记（那是撤销，不是动态）
    if (b.status === 'reading') {
      events.push({ bookId: b.id, bookTitle: b.title, type: 'started' });
    } else if (b.status === 'finished') {
      events.push({ bookId: b.id, bookTitle: b.title, type: 'finished' });
    }
  }

  addActivities(userId, events);
}

router.post('/batch', (req, res, next) => {
  try {
    const { books } = batchSaveSchema.parse(req.body);
    const userId = req.user!.id;

    const upsert = db.prepare(UPSERT_BOOK_SQL);

    // 事务：先删除用户所有书，再批量插入
    // 这样前端只需要把当前状态全量发过来，后端自动同步
    const tx = db.transaction((allBooks: any[]) => {
      // 先取旧快照（必须在 DELETE 之前，否则 diff 拿不到被删的书）
      const before = new Map<string, BookSnapshot>();
      const oldRows = db
        .prepare('SELECT id, title, status FROM books WHERE user_id = ?')
        .all(userId) as Array<{ id: string; title: string; status: string }>;
      for (const r of oldRows) before.set(r.id, { title: r.title, status: r.status });

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

      recordLibraryDiff(
        userId,
        before,
        allBooks.map((b) => ({ id: b.id, title: b.title, status: b.status || 'unread' })),
      );
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
    const userId = req.user!.id;
    // 先取书名：删除后这一行就没了，动态里要显示"删除了《XXX》"
    const row = db
      .prepare('SELECT id, title FROM books WHERE id = ? AND user_id = ?')
      .get(req.params.id, userId) as { id: string; title: string } | undefined;

    if (!row) {
      throw new AppError('BOOK_NOT_FOUND', '书籍不存在', 404);
    }

    db.prepare('DELETE FROM books WHERE id = ? AND user_id = ?').run(req.params.id, userId);
    addActivity(userId, row.id, row.title, 'deleted');

    res.json({ success: true, data: { id: req.params.id } });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 重新抓取单本书的豆瓣数据
//
// 为什么需要这个端点：书籍导入时的豆瓣抓取可能失败（Python 缺失、超时、
// 限流），失败的书在库里就是"只有书名+AI 分类"，封面/出版社/评分/简介全空。
// 以前唯一的补救办法是删掉重加，会连阅读进度、AI 解读、自评星级一起丢掉。
//
// 合并策略（关键）：只填补空白，不覆盖用户已有的东西。
// - doubanData：新数据"更完整"才整体替换（用 doubanDataScore 比较），
//   否则保留旧的 —— 避免用 suggest 级别的残缺数据冲掉完整的详情。
// - author / publisher / doubanId / coverUrl / isbn：仅在原值为空时填入。
// - title / category / level / userData / aiInsight：一律不动。
//   书名和分类可能是用户手改过的，阅读进度与 AI 解读更是无价。
// ============================================================================

router.post('/:id/refresh-douban', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const row = db
      .prepare('SELECT * FROM books WHERE id = ? AND user_id = ?')
      .get(req.params.id, userId) as BookRow | undefined;

    if (!row) {
      throw new AppError('BOOK_NOT_FOUND', '书籍不存在', 404);
    }

    const book = rowToBook(row);
    const fetched = await refetchBookDetail(book.doubanId, book.title);

    if (!fetched) {
      throw new AppError('BOOK_NOT_FOUND', '豆瓣上没找到这本书，请检查书名是否准确', 404);
    }

    const oldData = book.doubanData as DoubanBookData | undefined;
    const oldScore = doubanDataScore(oldData);
    const newScore = doubanDataScore(fetched);

    // 新数据不够完整就不替换，避免把好的冲成差的
    const shouldReplaceDouban = newScore > oldScore;
    // 完全没数据时即使得分相同（比如都是 0）也该写入，否则刷新等于没做
    const hadNothing = !oldData || Object.keys(oldData).length === 0;

    const merged = {
      ...book,
      // 只在原值为空时补，保留用户可能手改过的书名/作者/出版社
      author: book.author || (fetched.author || []).join(', '),
      publisher: book.publisher || fetched.publisher || undefined,
      doubanId: book.doubanId || fetched.id,
      isbn: book.isbn || fetched.isbn || fetched.isbn13 || undefined,
      pubDate: book.pubDate || fetched.pubdate || fetched.publish_year || undefined,
      publishYear: book.publishYear || fetched.publish_year || undefined,
      doubanRating: fetched.rating_score || book.doubanRating,
      // 封面只在没有时补（已有封面的书不必因为一次刷新就换图）
      coverUrl: book.coverUrl || (fetched.cover_url
        ? `${req.protocol}://${req.get('host')}/api/douban/cover?url=${encodeURIComponent(fetched.cover_url)}`
        : undefined),
      doubanData: shouldReplaceDouban || hadNothing ? fetched : oldData,
    };

    db.prepare(UPSERT_BOOK_SQL).run(bookToParams(userId, merged));

    const updated = db
      .prepare('SELECT * FROM books WHERE id = ? AND user_id = ?')
      .get(req.params.id, userId) as BookRow;

    res.json({
      success: true,
      data: rowToBook(updated),
      meta: {
        // 前端据此提示"补全成功"还是"已是最新，没有更完整的数据"
        replaced: shouldReplaceDouban || hadNothing,
        oldScore,
        newScore,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
