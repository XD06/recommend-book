/**
 * 路由聚合
 */

import { Router } from 'express';
import aiRoutes from './ai';
import doubanRoutes from './douban';

const router = Router();

// AI 相关路由
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
