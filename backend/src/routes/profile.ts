/**
 * 用户画像 & 分类元数据路由
 */

import { Router } from 'express';
import { z } from 'zod';
import db from '../db/database';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../types';

const router = Router();

router.use(requireAuth);

// ============================================================================
// 获取用户画像
// ============================================================================

router.get('/', (req, res) => {
  const row = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(req.user!.id) as any;
  if (!row) {
    // 不存在就创建一个默认的
    db.prepare('INSERT INTO user_profiles (user_id, reading_level) VALUES (?, ?)').run(req.user!.id, 'beginner');
    res.json({
      success: true,
      data: {
        readingLevel: 'beginner',
        preferredCategories: [],
      },
    });
    return;
  }

  res.json({
    success: true,
    data: {
      nickname: row.nickname || undefined,
      readingLevel: row.reading_level,
      readingGoal: row.reading_goal || undefined,
      preferredCategories: row.preferred_categories ? JSON.parse(row.preferred_categories) : [],
      dailyReadingTime: row.daily_reading_time ?? undefined,
      aiAnalysis: row.ai_analysis ? JSON.parse(row.ai_analysis) : undefined,
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
  const userId = req.user!.id;

  // 确保画像行存在
  db.prepare(`
    INSERT INTO user_profiles (user_id, reading_level) VALUES (?, 'beginner')
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId);

  // 动态构建 UPDATE
  const fields: string[] = [];
  const values: any[] = [];

  if (data.nickname !== undefined) { fields.push('nickname = ?'); values.push(data.nickname); }
  if (data.readingLevel !== undefined) { fields.push('reading_level = ?'); values.push(data.readingLevel); }
  if (data.readingGoal !== undefined) { fields.push('reading_goal = ?'); values.push(data.readingGoal); }
  if (data.preferredCategories !== undefined) { fields.push('preferred_categories = ?'); values.push(JSON.stringify(data.preferredCategories)); }
  if (data.dailyReadingTime !== undefined) { fields.push('daily_reading_time = ?'); values.push(data.dailyReadingTime); }
  if (data.aiAnalysis !== undefined) { fields.push('ai_analysis = ?'); values.push(JSON.stringify(data.aiAnalysis)); }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(userId);

  if (fields.length > 1) {
    db.prepare(`UPDATE user_profiles SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);
  }

  // 返回更新后的画像
  const row = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId) as any;
  res.json({
    success: true,
    data: {
      nickname: row.nickname || undefined,
      readingLevel: row.reading_level,
      readingGoal: row.reading_goal || undefined,
      preferredCategories: row.preferred_categories ? JSON.parse(row.preferred_categories) : [],
      dailyReadingTime: row.daily_reading_time ?? undefined,
      aiAnalysis: row.ai_analysis ? JSON.parse(row.ai_analysis) : undefined,
    },
  });
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
