/**
 * 用户画像 & 分类元数据路由
 */

import { Router } from 'express';
import { z } from 'zod';
import db, { loadUserLibrary, loadUserProfile, updateUserProfileInDb } from '../db/database';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../types';
import { computeLibraryStats } from '../services/libraryStats';

const router = Router();

router.use(requireAuth);

// ============================================================================
// 获取用户画像
// ============================================================================

router.get('/', (req, res) => {
  const userId = req.user!.id;
  const profile = loadUserProfile(userId);
  if (profile) {
    res.json({ success: true, data: profile });
    return;
  }
  // 不存在就创建一个默认的
  db.prepare('INSERT INTO user_profiles (user_id, reading_level) VALUES (?, ?)').run(userId, 'beginner');
  res.json({
    success: true,
    data: {
      readingLevel: 'beginner',
      preferredCategories: [],
    },
  });
});

// ============================================================================
// 更新用户画像
// ============================================================================

const updateProfileSchema = z.object({
  nickname: z.string().optional(),
  readingLevel: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
  readingGoal: z.string().optional(),
  preferredCategories: z.array(z.string()).optional(),
  dailyReadingTime: z.number().optional(),
  aiAnalysis: z.any().optional(),
});

router.put('/', (req, res) => {
  const data = updateProfileSchema.parse(req.body);
  // 与 Agent 的 update_user_profile 工具共用同一个写入函数
  res.json({ success: true, data: updateUserProfileInDb(req.user!.id, data) });
});

// ============================================================================
// 书库统计
// ============================================================================

// 与 AI 概览共用 computeLibraryStats：页面数字与发给模型的数字同源
router.get('/stats', (req, res) => {
  res.json({ success: true, data: computeLibraryStats(loadUserLibrary(req.user!.id) as any) });
});

// ============================================================================
// 分类元数据
// ============================================================================

router.get('/category-meta', (req, res) => {
  const rows = db.prepare('SELECT category_name, meta FROM category_meta WHERE user_id = ?').all(req.user!.id) as any[];
  const result: Record<string, any> = {};
  for (const row of rows) {
    result[row.category_name] = JSON.parse(row.meta);
  }
  res.json({ success: true, data: result });
});

router.put('/category-meta', (req, res) => {
  const schema = z.object({
    categoryMeta: z.record(z.string(), z.any()),
  });
  const { categoryMeta } = schema.parse(req.body);
  const userId = req.user!.id;

  const upsert = db.prepare(`
    INSERT INTO category_meta (user_id, category_name, meta, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, category_name) DO UPDATE SET meta = excluded.meta, updated_at = excluded.updated_at
  `);

  const now = new Date().toISOString();
  for (const [name, meta] of Object.entries(categoryMeta)) {
    upsert.run(userId, name, JSON.stringify(meta), now);
  }

  res.json({ success: true });
});

export default router;
