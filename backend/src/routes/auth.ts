/**
 * 认证路由 — 注册 / 登录 / 获取当前用户
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { signToken, requireAuth } from '../middleware/auth';
import { AppError } from '../types';

const router = Router();

// ============================================================================
// 验证 schema
// ============================================================================

const registerSchema = z.object({
  username: z.string().min(2).max(20),
  email: z.string().email(),
  password: z.string().min(6).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ============================================================================
// 注册
// ============================================================================

router.post('/register', async (req, res, next) => {
  try {
    const { username, email, password } = registerSchema.parse(req.body);

    // 检查邮箱是否已注册
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      throw new AppError('EMAIL_EXISTS', '该邮箱已被注册', 409);
    }

    // 检查用户名是否被占用
    const existingName = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingName) {
      throw new AppError('USERNAME_EXISTS', '该用户名已被占用', 409);
    }

    // 创建用户
    const userId = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);

    db.prepare(`
      INSERT INTO users (id, username, email, password_hash)
      VALUES (?, ?, ?, ?)
    `).run(userId, username, email, passwordHash);

    // 创建空画像
    db.prepare(`
      INSERT INTO user_profiles (user_id, reading_level)
      VALUES (?, 'beginner')
    `).run(userId);

    // 签发 token
    const token = signToken({ id: userId, username, email });

    res.status(201).json({
      success: true,
      data: {
        token,
        user: { id: userId, username, email },
      },
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      next(new AppError('VALIDATION_ERROR', err.errors[0]?.message || '参数错误', 400));
      return;
    }
    next(err);
  }
});

// ============================================================================
// 登录
// ============================================================================

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = db.prepare('SELECT id, username, email, password_hash FROM users WHERE email = ?').get(email) as
      | { id: string; username: string; email: string; password_hash: string }
      | undefined;

    if (!user) {
      throw new AppError('INVALID_CREDENTIALS', '邮箱或密码错误', 401);
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      throw new AppError('INVALID_CREDENTIALS', '邮箱或密码错误', 401);
    }

    const token = signToken({ id: user.id, username: user.username, email: user.email });

    res.json({
      success: true,
      data: {
        token,
        user: { id: user.id, username: user.username, email: user.email },
      },
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      next(new AppError('VALIDATION_ERROR', err.errors[0]?.message || '参数错误', 400));
      return;
    }
    next(err);
  }
});

// ============================================================================
// 获取当前用户信息
// ============================================================================

router.get('/me', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: req.user,
  });
});

export default router;
