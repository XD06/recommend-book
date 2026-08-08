/**
 * DeepRead Backend
 * 
 * Express + TypeScript + DeepSeek AI + 豆瓣 API 代理
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import routes from './routes';
import { AppError } from './types';
import { initDatabase } from './db/database';

// 加载环境变量
dotenv.config();

// 初始化 SQLite 数据库（零安装，文件型）
initDatabase();

const app = express();
const PORT = process.env.PORT || 3001;

// 安全中间件
app.use(helmet());

// CORS
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://localhost:3000'];
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (allowedOrigins.length > 0 ? allowedOrigins : true)
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));

// 请求日志
app.use(morgan('dev'));

// 压缩响应
app.use(compression());

// 限流
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: { success: false, error: '请求过于频繁，请稍后再试' },
});
app.use(limiter);

// 解析 JSON
app.use(express.json({ limit: '10mb' }));

// 路由
app.use('/api', routes);

// 404 处理
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: '接口不存在',
    path: req.path,
  });
});

// 错误处理
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
      details: err.details,
    });
    return;
  }

  // 默认错误响应
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? '服务器内部错误' 
      : err.message,
    code: 'INTERNAL_ERROR',
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   DeepRead Backend Server                                ║
║   Running on http://localhost:${PORT}                      ║
║                                                          ║
║   Environment: ${process.env.NODE_ENV || 'development'}${' '.repeat(20 - (process.env.NODE_ENV || 'development').length)}║
║   API Base: http://localhost:${PORT}/api                   ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
  
  // 检查必要的环境变量
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('⚠️  Warning: DEEPSEEK_API_KEY not set. AI features will not work.');
  }
});

export default app;
