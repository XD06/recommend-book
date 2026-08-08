/**
 * 豆瓣 API 代理路由
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  searchBooks,
  getBookDetail,
  batchGetBookDetails,
  findBookByTitle,
  getBookComments,
  getCacheStats,
  preloadCache,
} from '../services/doubanService';
import { AppError, ErrorCode } from '../types';

const router = Router();

// 搜索书籍
router.get('/search', async (req, res, next) => {
  try {
    const { q, count } = req.query;
    
    if (!q || typeof q !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, '搜索关键词不能为空', 400);
    }

    const limit = count ? parseInt(count as string, 10) : 10;
    const result = await searchBooks(q, limit);
    
    res.json({
      success: true,
      data: result,
      meta: {
        query: q,
        count: result.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

// 获取书籍详情
router.get('/book/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await getBookDetail(id);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// 批量获取书籍详情
router.post('/batch', async (req, res, next) => {
  try {
    const { ids } = req.body;
    
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, '书籍ID列表不能为空', 400);
    }

    if (ids.length > 20) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, '一次最多查询20本书', 400);
    }

    const result = await batchGetBookDetails(ids);
    res.json({
      success: true,
      data: result,
      meta: {
        requested: ids.length,
        found: result.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

// 获取封面图片（二进制）
router.get('/cover', async (req, res, next) => {
  try {
    const { url } = req.query;
    
    if (!url || typeof url !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, '图片URL不能为空', 400);
    }

    const response = await fetch(url);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(data);
  } catch (error) {
    next(error);
  }
});

// 获取封面图片（Base64）
router.get('/cover/base64', async (req, res, next) => {
  try {
    const { url } = req.query;
    
    if (!url || typeof url !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, '图片URL不能为空', 400);
    }

    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const result = Buffer.from(arrayBuffer).toString('base64');
    
    res.json({
      success: true,
      data: {
        base64: result,
      },
    });
  } catch (error) {
    next(error);
  }
});

// 智能查找书籍（根据书名，缓存优先）
router.post('/find', async (req, res, next) => {
  try {
    const { title } = req.body;
    
    if (!title || typeof title !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, '书名不能为空', 400);
    }

    const result = await findBookByTitle(title);
    
    if (!result) {
      throw new AppError(ErrorCode.BOOK_NOT_FOUND, '未找到该书籍', 404);
    }
    
    res.json({
      success: true,
      data: result,
      meta: {
        fromCache: !!result.book.scraped_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

// 获取书籍短评（用于 AI 分析）
router.get('/book/:id/comments', async (req, res, next) => {
  try {
    const { id } = req.params;
    const comments = await getBookComments(id);
    res.json({
      success: true,
      data: comments,
      meta: { count: comments.length },
    });
  } catch (error) {
    next(error);
  }
});

// 缓存管理
router.get('/cache/stats', (req, res) => {
  const stats = getCacheStats();
  res.json({ success: true, data: stats });
});

// 预加载缓存（启动时调用）
router.post('/cache/preload', async (req, res) => {
  await preloadCache();
  res.json({ success: true, message: '缓存预加载完成' });
});

export default router;
