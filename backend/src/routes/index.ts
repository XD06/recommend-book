/**
 * 路由聚合
 */

import { Router } from 'express';
import aiRoutes from './ai';
import doubanRoutes from './douban';
import authRoutes from './auth';
import bookRoutes from './books';
import profileRoutes from './profile';

const router = Router();

// 认证路由（无需登录）
router.use('/auth', authRoutes);

// 书库 CRUD 路由（需要登录）
router.use('/books', bookRoutes);

// 用户画像路由（需要登录）
router.use('/profile', profileRoutes);

// AI 相关路由（需要登录）
router.use('/ai', aiRoutes);

// 豆瓣代理路由
router.use('/douban', doubanRoutes);

// 健康检查
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

export default router;
