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

// 即时请求日志（morgan 只在响应完成后输出，SSE 流式请求需要即时日志）
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path.startsWith('/api/ai/')) {
    console.log(`[AI] ← ${req.method} ${req.path}  @ ${new Date().toLocaleTimeString()}`);
  }
  next();
});

// 请求日志
app.use(morgan('dev'));

// 压缩响应（跳过 SSE 流式端点）
app.use(compression({
  filter: (req, res) => {
    if (req.path.includes('/stream')) return false;
    return compression.filter(req, res);
  },
}));

// 限流
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: { success: false, error: '请求过于频繁，请稍后再试' },
});
app.use(limiter);

// 解析 JSON
app.use(express.json({ limit: '50mb' }));

// body 解析完成后的日志（用于诊断 body 解析是否卡住）
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path.startsWith('/api/ai/')) {
    const bodySize = req.body ? JSON.stringify(req.body).length : 0;
    console.log(`[AI] ✓ body parsed: ${(bodySize / 1024).toFixed(1)}KB, library=${req.body?.library?.length || 0} books`);
  }
  next();
});

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
  if (!process.env.LITELLM_BASE_URL && !process.env.DEEPSEEK_API_KEY) {
    console.warn('⚠️  Warning: Neither LITELLM_BASE_URL nor DEEPSEEK_API_KEY set. AI features will not work.');
  } else if (process.env.LITELLM_BASE_URL) {
    console.log('✓ LiteLLM proxy configured:', process.env.LITELLM_BASE_URL, '| model:', process.env.LITELLM_MODEL || 'default');
  }
});

export default app;
